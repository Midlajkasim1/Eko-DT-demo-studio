"""Where the FIN session's credentials may go: every request that carries them (fetch_api, fetch_probe, get_probe) goes
through one rule, FinScramClient._url. A request to this FIN server is sent; one that would reach any other host is
refused before anything leaves the backend, and one that cannot be read as a URL is refused too."""
import asyncio
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from fin_client import FinScramClient  # noqa: E402

BASE = "https://fin.example:8443"
TOKEN = "scram secret-token"

# (what the request names, why it must be refused)
REFUSED = [
    ("https://evil.example/steal", "another host"),
    ("http://fin.example:8443/api/x", "another scheme"),
    ("https://fin.example:9999/api/x", "another port"),
    ("https://fin.example/api/x", "no port is not port 8443"),
    ("https://fin.example.evil.example:8443/api/x", "the FIN name as a prefix of another host"),
    ("https://fin.example:8443@evil.example/x", "the FIN address as a user name before another host"),
    ("@evil.example/x", "a path that would turn the FIN address into a user name"),
    (".evil.example/x", "a path that does not start with a slash"),
    ("api/x", "a relative path with no leading slash"),
    ("ftp://fin.example:8443/x", "another protocol"),
    ("http://[::1", "a URL that cannot be read"),
    ("https://[fin.example/x", "a broken host"),
    ("", "nothing"),
    (None, "not a string"),
    (12, "not a string"),
]
ACCEPTED = [
    ("/api/proj/eval?expr=a", BASE + "/api/proj/eval?expr=a"),
    ("/", BASE + "/"),
    ("https://fin.example:8443/api/proj/x", "https://fin.example:8443/api/proj/x"),
    ("https://FIN.EXAMPLE:8443/api/proj/y", "https://FIN.EXAMPLE:8443/api/proj/y"),
]


class FakeResponse:
    status_code = 200
    text = 'ver:"3.0"\nx\n1\n'

    def json(self):
        return {}


def make_client():
    c = FinScramClient(BASE + "/", "proj")      # a trailing slash is the server's own address all the same
    c.auth_headers = {"Authorization": TOKEN}
    sent = []

    async def get(url, headers=None, params=None):
        sent.append({"url": url, "headers": dict(headers or {}), "params": params})
        return FakeResponse()
    c.client.get = get
    return c, sent


class FinClientUrlTests(unittest.TestCase):
    def run_all(self, c, endpoint):
        """The same endpoint through each of the three requests that carry the session."""
        return (asyncio.run(c.fetch_api(endpoint, is_text=True)), asyncio.run(c.fetch_probe(endpoint)),
                asyncio.run(c.get_probe(endpoint, {"q": "1"})))

    def test_a_request_that_would_reach_another_host_sends_nothing(self):
        for endpoint, why in REFUSED:
            c, sent = make_client()
            try:
                self.assertIsNone(c._url(endpoint), f"{why}: {endpoint!r}")
                api, probe, get = self.run_all(c, endpoint)
                self.assertIsNone(api, why)
                self.assertEqual(probe, (None, None), why)
                self.assertEqual(get, (None, None), f"get_probe, {why}")
                self.assertEqual(sent, [], f"{why}: the credentials left the backend")
            finally:
                asyncio.run(c.close())

    def test_this_fin_servers_own_addresses_are_sent_with_the_session_headers(self):
        for endpoint, expected in ACCEPTED:
            c, sent = make_client()
            try:
                self.assertEqual(c._url(endpoint), expected, endpoint)
                api, probe, get = self.run_all(c, endpoint)
                self.assertIsNotNone(api)
                self.assertEqual(probe[0], 200)
                self.assertEqual(get[0], 200)
                self.assertEqual([s["url"] for s in sent], [expected] * 3, endpoint)
                self.assertTrue(all(s["headers"].get("Authorization") == TOKEN for s in sent), "the session's headers go with them")
                self.assertEqual(sent[2]["params"], {"q": "1"}, "get_probe still passes its query parameters")
            finally:
                asyncio.run(c.close())

    def test_a_path_that_looks_protocol_relative_stays_on_this_server(self):
        """After the server's own address "//evil.example/x" is only a path (a double slash): it cannot name another host."""
        c, sent = make_client()
        try:
            self.assertEqual(c._url("//evil.example/x"), BASE + "//evil.example/x")
            asyncio.run(c.fetch_probe("//evil.example/x"))
            self.assertEqual([s["url"].split("/")[2] for s in sent], ["fin.example:8443"])
        finally:
            asyncio.run(c.close())

    def test_a_refused_request_does_not_end_the_session(self):
        c, sent = make_client()
        c.is_authenticated = True
        try:
            self.run_all(c, "https://evil.example/x")
            self.assertTrue(c.is_authenticated)
        finally:
            asyncio.run(c.close())


if __name__ == "__main__":
    unittest.main()
