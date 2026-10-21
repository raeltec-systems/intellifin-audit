//! Renderer `zobba-export-v2` (v1 before the Story 24.4 review round, the
//! same layout): deterministic DOCX and XLSX from one exact version of a
//! work product, frozen at that version, by trusted code. A stored (uncompressed) ZIP
//! with CRC-32 and minimal OOXML parts, no timestamps and a fixed part
//! order, so the same view always gives the same bytes. Every text is
//! written as text (a DOCX run, an XLSX inline string), never as a formula;
//! the one formula is the coverage `SUM`, whose cached value is the stored
//! total. Pure: a view in, bytes out.

/// CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320).
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut table = [0u32; 256];
    for (n, entry) in table.iter_mut().enumerate() {
        let mut c = n as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
        }
        *entry = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for b in bytes {
        crc = table[((crc ^ u32::from(*b)) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

/// A stored ZIP archive of the given entries, in order. Every entry has the
/// fixed DOS time 1980-01-01 00:00 and method 0 (stored).
pub fn zip(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    const DATE: u16 = (1 << 5) | 1; // 1980-01-01
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in entries {
        let offset = out.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let name = name.as_bytes();
        let header = |sig: u32, central: bool| {
            let mut h = Vec::new();
            h.extend_from_slice(&sig.to_le_bytes());
            if central {
                h.extend_from_slice(&20u16.to_le_bytes()); // made by
            }
            h.extend_from_slice(&20u16.to_le_bytes()); // needed
            h.extend_from_slice(&0u16.to_le_bytes()); // flags
            h.extend_from_slice(&0u16.to_le_bytes()); // stored
            h.extend_from_slice(&0u16.to_le_bytes()); // time
            h.extend_from_slice(&DATE.to_le_bytes());
            h.extend_from_slice(&crc.to_le_bytes());
            h.extend_from_slice(&size.to_le_bytes());
            h.extend_from_slice(&size.to_le_bytes());
            h.extend_from_slice(&(name.len() as u16).to_le_bytes());
            h.extend_from_slice(&0u16.to_le_bytes()); // extra
            if central {
                h.extend_from_slice(&0u16.to_le_bytes()); // comment
                h.extend_from_slice(&0u16.to_le_bytes()); // disk
                h.extend_from_slice(&0u16.to_le_bytes()); // internal
                h.extend_from_slice(&0u32.to_le_bytes()); // external
                h.extend_from_slice(&offset.to_le_bytes());
            }
            h.extend_from_slice(name);
            h
        };
        out.extend(header(0x0403_4b50, false));
        out.extend_from_slice(data);
        central.extend(header(0x0201_4b50, true));
    }
    let start = out.len() as u32;
    let length = central.len() as u32;
    out.extend(central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

/// The entries of a stored ZIP written by [`zip`] (for tests and the
/// download check): name and bytes, CRC-checked. None for anything else.
pub fn unzip(bytes: &[u8]) -> Option<Vec<(String, Vec<u8>)>> {
    let u16_at = |i: usize| Some(u16::from_le_bytes(bytes.get(i..i + 2)?.try_into().ok()?));
    let u32_at = |i: usize| Some(u32::from_le_bytes(bytes.get(i..i + 4)?.try_into().ok()?));
    let mut at = 0usize;
    let mut out = Vec::new();
    while u32_at(at)? == 0x0403_4b50 {
        let method = u16_at(at + 8)?;
        let crc = u32_at(at + 14)?;
        let size = u32_at(at + 18)? as usize;
        let name_len = u16_at(at + 26)? as usize;
        let extra = u16_at(at + 28)? as usize;
        let name = std::str::from_utf8(bytes.get(at + 30..at + 30 + name_len)?).ok()?;
        let start = at + 30 + name_len + extra;
        let data = bytes.get(start..start + size)?.to_vec();
        if method != 0 || crc32(&data) != crc {
            return None;
        }
        out.push((name.to_string(), data));
        at = start + size;
    }
    Some(out)
}

/// XML text: `& < > "` escaped; characters XML 1.0 forbids (controls but
/// tab, newline and carriage return; U+FFFE, U+FFFF) replaced by U+FFFD.
pub fn xml(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\t' | '\n' | '\r' => out.push(c),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => out.push('\u{FFFD}'),
            c => out.push(c),
        }
    }
    out
}

/// One block of an exported section, as trusted code resolved it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExportBlock {
    Heading(String),
    Narrative {
        judgment: bool,
        text: String,
    },
    Claim {
        /// Its claim number (1-based): `[n]` links to citation entry n.
        number: usize,
        statement: String,
        /// The platform coverage line of its summary or basis.
        coverage: Option<String>,
        /// "Needs refresh: <reason>" words at export time; empty: current.
        refresh: Vec<String>,
        /// What the claim's records say, in the platform's words.
        support: Vec<String>,
    },
    /// Platform lines rendered from a summary or a basis's exceptions.
    Lines(Vec<String>),
    /// The limitations block (its lines are the view's limitations).
    Limitations,
}

/// One template section in template order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportSection {
    pub title: String,
    pub required: bool,
    pub blocks: Vec<ExportBlock>,
}

/// One record a claim rests on, for the Citations appendix.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportCitation {
    pub claim: usize,
    pub record_kind: String,
    pub record_id: String,
    pub digest: String,
    pub value: String,
    /// A quote: the original's filename, its locator and the quote, or None
    /// when withheld for this viewer.
    pub quote: Option<(String, String, String)>,
    pub withheld: bool,
}

/// The exact counts of one cited summary for the Coverage sheet: the
/// subject partition (failing, meeting every applicable criterion,
/// unresolved, not applicable to any) and its stored total.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportCoverage {
    pub summary_id: String,
    pub line: String,
    pub partition: [(String, u64); 4],
    pub total_label: String,
    /// The summary's stored total: its in-scope subjects, or its selected
    /// items for a sample.
    pub total: u64,
    /// Whether the total is exact (a complete population or a sample); an
    /// incomplete population's is only "at least".
    pub exact: bool,
}

/// Everything an export shows, resolved by trusted code from one exact
/// version (and the records it pins, under the requesting viewer's access).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExportView {
    pub version_id: String,
    pub version: u32,
    pub digest: String,
    pub title: String,
    pub kind: String,
    pub template: String,
    pub sections: Vec<ExportSection>,
    pub citations: Vec<ExportCitation>,
    pub limitations: Vec<String>,
    pub coverage: Vec<ExportCoverage>,
    /// "Prepared by Zobba (agent)[; edited by <names>]".
    pub preparation: String,
}
impl ExportView {
    /// "Source revision: <version ID> · version n · sha256 <digest>".
    pub fn source_revision(&self) -> String {
        format!(
            "Source revision: {} · version {} · sha256 {}",
            self.version_id, self.version, self.digest
        )
    }
    /// The preparation and review sentence.
    pub fn review(&self) -> String {
        format!(
            "Preparation and review: {}. Review state: {} — not reviewed.",
            self.preparation,
            super::REVIEW_STATE
        )
    }
    /// The number of claims at export time that need refresh.
    pub fn refresh_count(&self) -> u64 {
        self.sections
            .iter()
            .flat_map(|s| &s.blocks)
            .filter(|b| matches!(b, ExportBlock::Claim { refresh, .. } if !refresh.is_empty()))
            .count() as u64
    }
}

// ------------------------------------------------------------------ DOCX

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const DECLARATION: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

fn run(text: &str) -> String {
    let mut out = String::new();
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            out.push_str("<w:br/>");
        }
        out.push_str(&format!(
            "<w:t xml:space=\"preserve\">{}</w:t>",
            xml(line.trim_end_matches('\r'))
        ));
    }
    format!("<w:r>{out}</w:r>")
}
fn styled_run(style: &str, text: &str) -> String {
    run(text).replacen(
        "<w:r>",
        &format!("<w:r><w:rPr><w:rStyle w:val=\"{style}\"/></w:rPr>"),
        1,
    )
}
fn paragraph(style: Option<&str>, body: &str) -> String {
    match style {
        Some(style) => format!("<w:p><w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>{body}</w:p>"),
        None => format!("<w:p>{body}</w:p>"),
    }
}
fn anchor(n: usize) -> String {
    format!("citation_{n}")
}

/// The DOCX bytes of a view.
pub fn docx(view: &ExportView) -> Vec<u8> {
    let mut body = String::new();
    body.push_str(&paragraph(Some("Title"), &run(&view.title)));
    body.push_str(&paragraph(None, &run(&view.source_revision())));
    body.push_str(&paragraph(
        None,
        &run(&format!(
            "Kind: {} · Template: {}",
            view.kind, view.template
        )),
    ));
    body.push_str(&paragraph(None, &run(&view.review())));
    for section in &view.sections {
        body.push_str(&paragraph(Some("Heading1"), &run(&section.title)));
        let content = section
            .blocks
            .iter()
            .any(|b| !matches!(b, ExportBlock::Limitations));
        if !content && section.required {
            body.push_str(&paragraph(None, &run(super::NOT_COMPLETED)));
        }
        for block in &section.blocks {
            match block {
                ExportBlock::Heading(text) => {
                    body.push_str(&paragraph(Some("Heading2"), &run(text)))
                }
                ExportBlock::Narrative { judgment, text } => {
                    if *judgment {
                        body.push_str(&paragraph(
                            None,
                            &styled_run("Emphasis", super::JUDGMENT_LABEL),
                        ));
                    }
                    body.push_str(&paragraph(None, &run(text)));
                }
                ExportBlock::Claim {
                    number,
                    statement,
                    coverage,
                    refresh,
                    support,
                } => {
                    let link = format!(
                        "<w:hyperlink w:anchor=\"{}\" w:history=\"1\">{}</w:hyperlink>",
                        anchor(*number),
                        styled_run("Hyperlink", &format!("[{number}]"))
                    );
                    body.push_str(&paragraph(
                        None,
                        &format!("{}{}", run(&format!("{statement} ")), link),
                    ));
                    for line in support {
                        body.push_str(&paragraph(Some("Note"), &run(line)));
                    }
                    if let Some(line) = coverage {
                        body.push_str(&paragraph(Some("Note"), &run(line)));
                    }
                    for reason in refresh {
                        body.push_str(&paragraph(
                            Some("Note"),
                            &run(&format!("Needs refresh: {reason}")),
                        ));
                    }
                }
                ExportBlock::Lines(lines) => {
                    for line in lines {
                        body.push_str(&paragraph(Some("Note"), &run(line)));
                    }
                }
                ExportBlock::Limitations => {
                    body.push_str(&paragraph(Some("Heading2"), &run("Limitations")));
                    if view.limitations.is_empty() {
                        body.push_str(&paragraph(None, &run("No limitations are recorded.")));
                    }
                    for line in &view.limitations {
                        body.push_str(&paragraph(Some("Note"), &run(line)));
                    }
                }
            }
        }
    }
    body.push_str(&paragraph(Some("Heading1"), &run("Citations")));
    let mut seen = std::collections::BTreeSet::new();
    for (index, c) in view.citations.iter().enumerate() {
        let first = seen.insert(c.claim);
        let mut text = format!(
            "{}{} {} · sha256 {} · {}",
            if first {
                format!("[{}] ", c.claim)
            } else {
                "    ".into()
            },
            c.record_kind,
            c.record_id,
            c.digest,
            c.value
        );
        if c.withheld {
            text.push_str(" · quote withheld for this viewer");
        } else if let Some((file, locator, quote)) = &c.quote {
            text.push_str(&format!(" · {file} at {locator}: \u{201c}{quote}\u{201d}"));
        }
        let content = run(&text);
        let marked = if first {
            format!(
                "<w:bookmarkStart w:id=\"{index}\" w:name=\"{}\"/>{content}<w:bookmarkEnd w:id=\"{index}\"/>",
                anchor(c.claim)
            )
        } else {
            content
        };
        body.push_str(&paragraph(None, &marked));
    }
    let document = format!(
        "{DECLARATION}<w:document xmlns:w=\"{W}\" xmlns:r=\"{R}\"><w:body>{body}<w:sectPr><w:footerReference w:type=\"default\" r:id=\"rId2\"/><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
    );
    let footer = format!(
        "{DECLARATION}<w:ftr xmlns:w=\"{W}\" xmlns:r=\"{R}\"><w:p><w:pPr><w:pStyle w:val=\"Footer\"/></w:pPr>{}<w:r><w:t xml:space=\"preserve\"> · Page </w:t></w:r><w:r><w:fldChar w:fldCharType=\"begin\"/></w:r><w:r><w:instrText xml:space=\"preserve\"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType=\"separate\"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType=\"end\"/></w:r></w:p></w:ftr>",
        run(&view.source_revision())
    );
    let style = |id: &str, kind: &str, name: &str, props: &str| {
        format!(
            "<w:style w:type=\"{kind}\" w:styleId=\"{id}\"><w:name w:val=\"{name}\"/>{props}</w:style>"
        )
    };
    let styles = format!(
        "{DECLARATION}<w:styles xmlns:w=\"{W}\">{}{}{}{}{}{}{}{}</w:styles>",
        style(
            "Normal",
            "paragraph",
            "Normal",
            "<w:qFormat/><w:rPr><w:sz w:val=\"22\"/></w:rPr>"
        ),
        style(
            "Title",
            "paragraph",
            "Title",
            "<w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:outlineLvl w:val=\"0\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"36\"/></w:rPr>"
        ),
        style(
            "Heading1",
            "paragraph",
            "heading 1",
            "<w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:outlineLvl w:val=\"0\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"28\"/></w:rPr>"
        ),
        style(
            "Heading2",
            "paragraph",
            "heading 2",
            "<w:basedOn w:val=\"Normal\"/><w:qFormat/><w:pPr><w:outlineLvl w:val=\"1\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"24\"/></w:rPr>"
        ),
        style(
            "Note",
            "paragraph",
            "Note",
            "<w:basedOn w:val=\"Normal\"/><w:pPr><w:ind w:left=\"360\"/></w:pPr><w:rPr><w:sz w:val=\"18\"/></w:rPr>"
        ),
        style(
            "Footer",
            "paragraph",
            "footer",
            "<w:basedOn w:val=\"Normal\"/><w:rPr><w:sz w:val=\"16\"/></w:rPr>"
        ),
        style(
            "Hyperlink",
            "character",
            "Hyperlink",
            "<w:rPr><w:color w:val=\"0B57A4\"/><w:u w:val=\"single\"/></w:rPr>"
        ),
        style("Emphasis", "character", "Emphasis", "<w:rPr><w:i/></w:rPr>"),
    );
    let types = format!(
        "{DECLARATION}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/><Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/></Types>"
    );
    let rels = format!(
        "{DECLARATION}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"
    );
    let document_rels = format!(
        "{DECLARATION}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" Target=\"footer1.xml\"/></Relationships>"
    );
    zip(&[
        ("[Content_Types].xml", types.into_bytes()),
        ("_rels/.rels", rels.into_bytes()),
        ("word/document.xml", document.into_bytes()),
        ("word/_rels/document.xml.rels", document_rels.into_bytes()),
        ("word/styles.xml", styles.into_bytes()),
        ("word/footer1.xml", footer.into_bytes()),
    ])
}

// ------------------------------------------------------------------ XLSX

/// An A1-style column name (1 = A).
fn column(mut n: usize) -> String {
    let mut out = Vec::new();
    while n > 0 {
        out.push(b'A' + ((n - 1) % 26) as u8);
        n = (n - 1) / 26;
    }
    out.reverse();
    String::from_utf8(out).expect("ASCII")
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Cell {
    Text(String),
    Number(u64),
    /// A formula and its cached value.
    Sum(String, u64),
}

fn sheet(rows: &[Vec<Cell>]) -> String {
    let mut data = String::new();
    for (r, row) in rows.iter().enumerate() {
        let r = r + 1;
        data.push_str(&format!("<row r=\"{r}\">"));
        for (c, cell) in row.iter().enumerate() {
            let at = format!("{}{r}", column(c + 1));
            match cell {
                // Every text is an inline string, never a formula.
                Cell::Text(text) => data.push_str(&format!(
                    "<c r=\"{at}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
                    xml(text)
                )),
                Cell::Number(n) => data.push_str(&format!("<c r=\"{at}\"><v>{n}</v></c>")),
                Cell::Sum(range, cached) => data.push_str(&format!(
                    "<c r=\"{at}\"><f>SUM({range})</f><v>{cached}</v></c>"
                )),
            }
        }
        data.push_str("</row>");
    }
    format!(
        "{DECLARATION}<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{data}</sheetData></worksheet>"
    )
}
fn t(text: &str) -> Cell {
    Cell::Text(text.into())
}

/// The XLSX bytes of a view: sheets `Work product`, `Claims`, `Citations`
/// and `Coverage`.
pub fn xlsx(view: &ExportView) -> Vec<u8> {
    let mut product = vec![
        vec![t("Title"), t(&view.title)],
        vec![t("Source revision"), t(&view.source_revision())],
        vec![t("Kind"), t(&view.kind)],
        vec![t("Template"), t(&view.template)],
        vec![t("Preparation and review"), t(&view.review())],
    ];
    let mut claims = vec![vec![
        t("Claim"),
        t("Section"),
        t("Statement"),
        t("Support"),
        t("Coverage"),
        t("Currency"),
    ]];
    for section in &view.sections {
        product.push(vec![t("Section"), t(&section.title)]);
        let content = section
            .blocks
            .iter()
            .any(|b| !matches!(b, ExportBlock::Limitations));
        if !content && section.required {
            product.push(vec![t(""), t(super::NOT_COMPLETED)]);
        }
        for block in &section.blocks {
            match block {
                ExportBlock::Heading(text) => product.push(vec![t("Heading"), t(text)]),
                ExportBlock::Narrative { judgment, text } => product.push(vec![
                    t(if *judgment {
                        super::JUDGMENT_LABEL
                    } else {
                        "Narrative"
                    }),
                    t(text),
                ]),
                ExportBlock::Claim {
                    number,
                    statement,
                    coverage,
                    refresh,
                    support,
                } => {
                    product.push(vec![t(&format!("Claim [{number}]")), t(statement)]);
                    claims.push(vec![
                        Cell::Number(*number as u64),
                        t(&section.title),
                        t(statement),
                        t(&support.join(" ")),
                        t(coverage.as_deref().unwrap_or("")),
                        t(&if refresh.is_empty() {
                            "Current".to_string()
                        } else {
                            refresh
                                .iter()
                                .map(|r| format!("Needs refresh: {r}"))
                                .collect::<Vec<_>>()
                                .join(" ")
                        }),
                    ]);
                }
                ExportBlock::Lines(lines) => {
                    for line in lines {
                        product.push(vec![t("Platform"), t(line)]);
                    }
                }
                ExportBlock::Limitations => {
                    if view.limitations.is_empty() {
                        product.push(vec![t("Limitations"), t("No limitations are recorded.")]);
                    }
                    for line in &view.limitations {
                        product.push(vec![t("Limitations"), t(line)]);
                    }
                }
            }
        }
    }
    let mut citations = vec![vec![
        t("Citation"),
        t("Record kind"),
        t("Record ID"),
        t("SHA-256"),
        t("Value"),
        t("Original"),
        t("Locator"),
        t("Quote"),
    ]];
    for c in &view.citations {
        let (file, locator, quote) = match (&c.quote, c.withheld) {
            (_, true) => (
                String::new(),
                String::new(),
                "withheld for this viewer".into(),
            ),
            (Some((f, l, q)), false) => (f.clone(), l.clone(), q.clone()),
            (None, false) => (String::new(), String::new(), String::new()),
        };
        citations.push(vec![
            Cell::Number(c.claim as u64),
            t(&c.record_kind),
            t(&c.record_id),
            t(&c.digest),
            t(&c.value),
            t(&file),
            t(&locator),
            t(&quote),
        ]);
    }
    let mut coverage = vec![vec![t("Summary"), t("Subjects"), t("Count"), t("Count is")]];
    for c in &view.coverage {
        coverage.push(vec![t(&c.summary_id), t(&c.line)]);
        // An incomplete population's counts are only "at least".
        let kind = if c.exact { "exact" } else { "at least" };
        let first = coverage.len() + 1;
        for (label, n) in &c.partition {
            coverage.push(vec![t(""), t(label), Cell::Number(*n), t(kind)]);
        }
        let last = coverage.len();
        let sum: u64 = c.partition.iter().map(|(_, n)| *n).sum();
        // The stored total, as a SUM only when the partition adds up to it
        // (a recalculation then shows the same number); never a formula
        // whose result would differ from the stored total.
        let total = if sum == c.total {
            Cell::Sum(format!("C{first}:C{last}"), c.total)
        } else {
            Cell::Number(c.total)
        };
        coverage.push(vec![t(""), t(&c.total_label), total, t(kind)]);
    }
    let names = ["Work product", "Claims", "Citations", "Coverage"];
    let workbook = format!(
        "{DECLARATION}<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"{R}\"><sheets>{}</sheets></workbook>",
        names
            .iter()
            .enumerate()
            .map(|(i, n)| format!(
                "<sheet name=\"{n}\" sheetId=\"{}\" r:id=\"rId{}\"/>",
                i + 1,
                i + 1
            ))
            .collect::<String>()
    );
    let workbook_rels = format!(
        "{DECLARATION}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{}<Relationship Id=\"rId5\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>",
        (1..=4)
            .map(|i| format!("<Relationship Id=\"rId{i}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{i}.xml\"/>"))
            .collect::<String>()
    );
    let styles = format!(
        "{DECLARATION}<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"1\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>"
    );
    let types = format!(
        "{DECLARATION}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>{}<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/></Types>",
        (1..=4)
            .map(|i| format!("<Override PartName=\"/xl/worksheets/sheet{i}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"))
            .collect::<String>()
    );
    let rels = format!(
        "{DECLARATION}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"
    );
    zip(&[
        ("[Content_Types].xml", types.into_bytes()),
        ("_rels/.rels", rels.into_bytes()),
        ("xl/workbook.xml", workbook.into_bytes()),
        ("xl/_rels/workbook.xml.rels", workbook_rels.into_bytes()),
        ("xl/styles.xml", styles.into_bytes()),
        ("xl/worksheets/sheet1.xml", sheet(&product).into_bytes()),
        ("xl/worksheets/sheet2.xml", sheet(&claims).into_bytes()),
        ("xl/worksheets/sheet3.xml", sheet(&citations).into_bytes()),
        ("xl/worksheets/sheet4.xml", sheet(&coverage).into_bytes()),
    ])
}

/// The media type of each format.
pub fn media_type(format: super::ExportFormat) -> &'static str {
    match format {
        super::ExportFormat::Docx => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        super::ExportFormat::Xlsx => {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        }
    }
}

/// Render a view in one format.
pub fn render(view: &ExportView, format: super::ExportFormat) -> Vec<u8> {
    match format {
        super::ExportFormat::Docx => docx(view),
        super::ExportFormat::Xlsx => xlsx(view),
    }
}
