import { useEffect, useRef, useState } from 'react'
import { fetchFinFiles, type FinFile } from '@/lib/finProjects'
import {
  documentsCsv,
  draftProblem,
  draftsFromFamilies,
  familiesFromDrafts,
  importDocumentsCsv,
  suggestDocuments,
  type DocumentDraft,
} from '@/lib/finDocuments'
import { newRowId } from '@/lib/mappingRows'
import type { FinDocumentFamily } from '@/types'

interface FinDocumentsEditorProps {
  value: FinDocumentFamily[] | undefined
  finProject: string
  finConnected: boolean
  onChange: (families: FinDocumentFamily[] | undefined, error: string | null) => void
}

type Row = DocumentDraft & { key: number }

const withKey = (draft: DocumentDraft): Row => ({ ...draft, key: newRowId() })

export function FinDocumentsEditor({ value, finProject, finConnected, onChange }: FinDocumentsEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => draftsFromFamilies(value).map(withKey))
  const [notice, setNotice] = useState<string | null>(null)
  const [pick, setPick] = useState<{ key: number; side: 'om' | 'w' } | null>(null)
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<{ project: string; items: FinFile[]; truncated: boolean; error?: string } | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const csvInput = useRef<HTMLInputElement>(null)
  const rowsRef = useRef(rows)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    rowsRef.current = rows
    onChangeRef.current = onChange
  })

  const report = (next: Row[]) => onChange(familiesFromDrafts(next), draftProblem(next, finProject))
  const commit = (next: Row[]) => {
    setRows(next)
    report(next)
  }

  useEffect(() => {
    onChangeRef.current(familiesFromDrafts(rowsRef.current), draftProblem(rowsRef.current, finProject))
  }, [finProject])

  const edit = (key: number, patch: Partial<DocumentDraft>) => commit(rows.map(row => (row.key === key ? { ...row, ...patch } : row)))

  const chooseFile = async (key: number, side: 'om' | 'w') => {
    setPick(prev => (prev?.key === key && prev.side === side ? null : { key, side }))
    setQuery('')
    if (!finProject || loadingFiles || (files && files.project === finProject && !files.error)) return
    setLoadingFiles(true)
    try {
      const result = await fetchFinFiles(finProject)
      setFiles({ project: finProject, items: result.files, truncated: result.truncated })
    } catch (err) {
      setFiles({ project: finProject, items: [], truncated: false, error: err instanceof Error ? err.message : 'Could not load FIN files.' })
    } finally {
      setLoadingFiles(false)
    }
  }

  const takeFile = (row: Row, side: 'om' | 'w', file: FinFile) => {
    if (side === 'om') edit(row.key, { omRef: file.ref, omName: row.omName.trim() ? row.omName : file.name })
    else edit(row.key, { wRef: file.ref, wName: row.wName.trim() ? row.wName : file.name })
    setPick(null)
  }

  const suggest = async () => {
    setNotice(null)
    if (!finProject) {
      setNotice('Choose a FIN project first.')
      return
    }
    setLoadingFiles(true)
    try {
      const result = files && files.project === finProject && !files.error ? files : await fetchFinFiles(finProject).then(loaded => {
        const next = { project: finProject, items: loaded.files, truncated: loaded.truncated }
        setFiles(next)
        return next
      })
      const suggested = suggestDocuments(result.items).map(withKey)
      if (!suggested.length) {
        setNotice('No O&M or warranty files named like O&M Manual-AHU or Warranty-AHU.')
        return
      }
      const kept = rows.filter(row => row.name.trim() && !suggested.some(item => item.name.toLowerCase() === row.name.trim().toLowerCase()))
      const next = [...kept, ...suggested]
      commit(next)
      const problem = draftProblem(next, finProject)
      setNotice(problem
        ? `Suggested ${suggested.length} groups. ${problem}`
        : `Suggested ${suggested.length} groups from the FIN file names, including the match words. Save Settings to keep them.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load FIN files.')
    } finally {
      setLoadingFiles(false)
    }
  }

  const copySite = async () => {
    setNotice(null)
    try {
      const res = await fetch('/backend/om-warranty.json?t=' + Date.now(), { cache: 'no-store' })
      if (!res.ok) {
        setNotice('om-warranty.json is not available from this studio.')
        return
      }
      const json = await res.json() as { families?: FinDocumentFamily[] }
      const next = draftsFromFamilies(Array.isArray(json.families) ? json.families : []).map(withKey)
      if (!next.length) {
        setNotice('om-warranty.json has no manuals.')
        return
      }
      const problem = draftProblem(next, finProject)
      commit(next)
      setNotice(problem
        ? `Copied ${next.length} ${next.length === 1 ? 'group' : 'groups'}, which cannot be saved yet. ${problem}`
        : `Copied ${next.length} ${next.length === 1 ? 'group' : 'groups'} from om-warranty.json. Save Settings and this project stops reading that file.`)
    } catch {
      setNotice('Could not read om-warranty.json.')
    }
  }

  const downloadCsv = () => {
    const text = documentsCsv(familiesFromDrafts(rows))
    const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${(finProject || 'project').replace(/[^\w-]+/g, '_')}-om-warranty.csv`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const importCsv = async (file: File) => {
    const result = importDocumentsCsv(await file.text(), finProject)
    if (result.error) {
      setNotice(`Not imported: ${result.error}`)
      return
    }
    commit(result.drafts.map(withKey))
    setNotice(`Imported ${result.drafts.length} ${result.drafts.length === 1 ? 'group' : 'groups'} from ${file.name}. Save Settings to keep them.`)
  }

  const shown = (files?.items ?? []).filter(file => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return file.name.toLowerCase().includes(needle) || file.ref.toLowerCase().includes(needle)
  }).slice(0, 80)

  const field = (label: string, value: string, onValue: (text: string) => void, placeholder: string) => (
    <div className="ds-field" style={{ marginBottom: 0 }}>
      <label>{label}</label>
      <input type="text" value={value} placeholder={placeholder} onChange={e => onValue(e.target.value)} />
    </div>
  )

  const manual = (row: Row, side: 'om' | 'w') => {
    const om = side === 'om'
    const open = pick?.key === row.key && pick.side === side
    const name = om ? row.omName : row.wName
    const nameAr = om ? row.omNameAr : row.wNameAr
    const ref = om ? row.omRef : row.wRef
    return (
      <div className="fdoc-doc">
        <h4>{om ? 'O&M manual' : 'Warranty'}</h4>
        <div className="fdoc-grid">
          {field('Name shown', name, text => edit(row.key, om ? { omName: text } : { wName: text }), om ? 'FCU O & M' : 'FCU warranty')}
          {field('Arabic name', nameAr, text => edit(row.key, om ? { omNameAr: text } : { wNameAr: text }), 'optional')}
        </div>
        <div className="ds-field" style={{ margin: '8px 0 0' }}>
          <label>FIN record</label>
          <div className="fdoc-ref">
            <input type="text" value={ref} placeholder="@p:project:r:…" spellCheck={false}
              onChange={e => edit(row.key, om ? { omRef: e.target.value } : { wRef: e.target.value })} />
            <button type="button" className="ds-btn ds-btn-secondary fpm-btn" disabled={!finConnected || !finProject}
              title={finConnected ? 'Pick a PDF from this FIN project' : 'Connect to FIN first. You can still paste the record.'}
              onClick={() => void chooseFile(row.key, side)}>
              {open ? 'Close' : 'Choose'}
            </button>
          </div>
        </div>
        {open && (
          <div className="fpm-picker">
            <input className="fpm-search" type="search" value={query} placeholder="Search FIN files by name"
              onChange={e => setQuery(e.target.value)} />
            {loadingFiles && <p className="ds-hint" style={{ margin: 0 }}>Loading files from {finProject}…</p>}
            {files?.error && <p className="ds-hint" style={{ margin: 0 }}>{files.error} Paste the record instead.</p>}
            {files && !files.error && files.project === finProject && !loadingFiles && (
              <>
                <p className="ds-hint" style={{ margin: 0 }}>
                  {files.items.length} files{files.truncated ? ' (list cut short)' : ''}.
                  {shown.length === 80 ? ' Showing the first 80. Type more of the name.' : ''}
                </p>
                <div className="fpm-list">
                  {shown.map(file => (
                    <button type="button" key={file.ref} className="fpm-opt" data-on={file.ref === ref ? 'true' : 'false'}
                      onClick={() => takeFile(row, side, file)}>
                      <span className="fpm-pname">{file.name}</span>
                      <span className="fpm-ref">{file.ref}</span>
                    </button>
                  ))}
                  {!shown.length && <p className="ds-hint" style={{ margin: '8px' }}>No file with that name.</p>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div data-testid="fin-documents-editor">
      <div className="fpm-csv">
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn" onClick={downloadCsv}>Download CSV</button>
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn" onClick={() => csvInput.current?.click()}>Import CSV</button>
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn" disabled={!finConnected || !finProject} onClick={() => void suggest()}>Suggest from FIN files</button>
        <button type="button" className="ds-btn ds-btn-secondary fpm-btn" onClick={() => void copySite()}>Copy om-warranty.json</button>
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void importCsv(file) }} />
      </div>
      {notice && <p className="ds-hint" style={{ marginTop: 0 }} data-testid="docs-notice">{notice}</p>}
      {rows.length === 0 && <p className="ds-hint" style={{ margin: '0 0 8px' }}>No equipment groups yet. Add one below.</p>}
      {rows.map((row, index) => (
        <div key={row.key} className="fdoc">
          <div className="fdoc-h">
            <div className="ds-field" style={{ margin: 0, flex: 1 }}>
              <label>Equipment group</label>
              <input type="text" value={row.name} placeholder="e.g. Fan coil" aria-label={`Group ${index + 1} name`}
                onChange={e => edit(row.key, { name: e.target.value })} />
            </div>
            <button type="button" className="ds-btn ds-btn-secondary fpm-btn" aria-label={`Remove group ${index + 1}`}
              onClick={() => commit(rows.filter(item => item.key !== row.key))}>
              Remove
            </button>
          </div>
          <div className="fdoc-grid">
            {field('Tags', row.tags, text => edit(row.key, { tags: text }), 'fcu, ahu')}
            {field('Codes in the asset id', row.codes, text => edit(row.key, { codes: text }), 'FCU, AHU')}
            {field('Words in the type', row.types, text => edit(row.key, { types: text }), 'fan coil')}
            {field('Words in the asset id', row.names, text => edit(row.key, { names: text }), 'CALORIF')}
          </div>
          {manual(row, 'om')}
          {manual(row, 'w')}
        </div>
      ))}
      <button type="button" className="ds-btn ds-btn-secondary fpm-btn"
        onClick={() => commit([...rows, withKey({ id: '', name: '', tags: '', codes: '', types: '', names: '', omName: '', omNameAr: '', omRef: '', wName: '', wNameAr: '', wRef: '' })])}>
        + Add equipment group
      </button>
    </div>
  )
}
