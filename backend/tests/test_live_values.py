"""Live point reads: FIN readById grid -> number the dashboard can use, without a FIN server.

Run from backend/:   python -m unittest discover -s tests -v

The FinScramClient under test is the real one; only its HTTP transport is replaced
(httpx.MockTransport), so fetch_api / fetch_live_point / _parse_zinc_value all run as in production.

FIXTURES ARE CONSTRUCTED, NOT CAPTURED: no readById response from the Marsa FIN server is in the
repository (config.json cites docs/equip+points.txt, which is not checked in). They follow the
Haystack 3 Zinc grammar (ver line, column names, one row; a Number is digits + optional unit), with
the IAQ point id from config.json and the 90.5 % IAQ value shown in the FIN UI.
"""
import asyncio
import os
import sys
import unittest

import httpx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from fin_client import FinScramClient  # noqa: E402

IAQ_ID = "p:{project}:r:3182047c-48342a8b"


def record(cur_val: str) -> str:
    """A readById grid for the IAQ point, curVal set to the given Zinc scalar."""
    return (
        'ver:"3.0"\n'
        'id,dis,point,kpi,cur,curVal,curStatus,unit,kind,siteRef\n'
        '@p:marsaAlArab:r:3182047c-48342a8b "IAQ Index","IAQ Index",M,M,M,'
        + cur_val + ',"ok","%","Number",@p:marsaAlArab:r:1 "Marsa Al Arab, Dubai"\n'
    )


def client_answering(status: int, body: str = "") -> FinScramClient:
    c = FinScramClient("https://fin.example", "marsaAlArab")
    c.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(status, text=body)))
    c.is_authenticated = True
    return c


def read(c: FinScramClient, point_id: str = IAQ_ID):
    return asyncio.run(c.fetch_live_point(point_id))


class LivePointValues(unittest.TestCase):
    def test_iaq_percent_reads_as_number(self):
        self.assertEqual(read(client_answering(200, record("90.5%"))), 90.5)

    def test_zero_is_a_reading(self):
        self.assertEqual(read(client_answering(200, record("0%"))), 0.0)

    def test_missing_or_invalid_stays_missing(self):
        # Zinc null, a missing cell and FIN's NA marker are not readings; NaN/INF are not numbers
        for cur in ("N", "", "NA"):
            self.assertIsNone(read(client_answering(200, record(cur))), cur)
        for cur in ("NaN", "INF"):
            self.assertNotIsInstance(read(client_answering(200, record(cur))), float, cur)

    def test_unauthenticated_is_not_an_empty_reading(self):
        c = client_answering(401)
        self.assertIsNone(read(c))
        self.assertFalse(c.is_authenticated, "a FIN 401 ends the session, so /api/fin/status reports it")

    def test_status_string_passes_through(self):
        # a status point is not a number; it is returned as text, never coerced to 0
        self.assertEqual(read(client_answering(200, record('"Good"'))), "Good")


if __name__ == "__main__":
    unittest.main()
