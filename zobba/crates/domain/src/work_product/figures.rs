//! Rule `statement_figures_v1`: every figure of a claim's sentence is one of
//! the values its checked assertions hold, and narrative or judgment text
//! carries no figure at all. A figure is a maximal run of decimal digits
//! (Unicode `Nd`) with `,` `.` grouping/decimal and `-` date separators
//! between digits. The only digits allowed outside a figure are inside a
//! closed identifier token that resolves to a record or template section the
//! version names (`A1`, `ISA 315`, `FY2025`, `INV-0042`). Pure and
//! deterministic: the same text and values always give the same answer.
use std::collections::BTreeSet;

/// The first code point of every Unicode 15.1 `Nd` block (each holds the ten
/// digits 0–9 in order), generated from Python's `unicodedata`.
const ND_ZEROS: [u32; 68] = [
    0x30, 0x660, 0x6F0, 0x7C0, 0x966, 0x9E6, 0xA66, 0xAE6, 0xB66, 0xBE6, 0xC66, 0xCE6, 0xD66,
    0xDE6, 0xE50, 0xED0, 0xF20, 0x1040, 0x1090, 0x17E0, 0x1810, 0x1946, 0x19D0, 0x1A80, 0x1A90,
    0x1B50, 0x1BB0, 0x1C40, 0x1C50, 0xA620, 0xA8D0, 0xA900, 0xA9D0, 0xA9F0, 0xAA50, 0xABF0,
    0xFF10, 0x104A0, 0x10D30, 0x11066, 0x110F0, 0x11136, 0x111D0, 0x112F0, 0x11450, 0x114D0,
    0x11650, 0x116C0, 0x11730, 0x118E0, 0x11950, 0x11C50, 0x11D50, 0x11DA0, 0x11F50, 0x16A60,
    0x16AC0, 0x16B50, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6, 0x1E140, 0x1E2F0, 0x1E4F0,
    0x1E950, 0x1FBF0,
];

/// Whether a character is a Unicode decimal digit (`Nd`).
pub fn is_decimal_digit(c: char) -> bool {
    let v = c as u32;
    ND_ZEROS.iter().any(|z| v >= *z && v < z + 10)
}

/// The closed verdict words: a claim that rests only on quotes may not use
/// one (case-insensitive, whole words).
pub const VERDICT_WORDS: &[&str] = &[
    "met",
    "unmet",
    "pass",
    "passed",
    "passes",
    "passing",
    "fail",
    "failed",
    "fails",
    "failing",
    "failure",
    "failures",
    "exception",
    "exceptions",
    "compliant",
    "noncompliant",
    "compliance",
    "noncompliance",
];

fn word_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ',' | '/' | ':' | '+' | '\'')
}

/// Word tokens: maximal runs of alphanumerics and `- _ . , / : + '`, with
/// leading and trailing characters that are not alphanumeric removed. Each
/// token is returned with its byte offset.
pub fn tokens<'t>(text: &'t str) -> Vec<(usize, &'t str)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let flush = |out: &mut Vec<(usize, &'t str)>, s: usize, e: usize| {
        let raw = &text[s..e];
        let trimmed_start = raw.trim_start_matches(|c: char| !c.is_alphanumeric());
        let offset = s + (raw.len() - trimmed_start.len());
        let trimmed = trimmed_start.trim_end_matches(|c: char| !c.is_alphanumeric());
        if !trimmed.is_empty() {
            out.push((offset, trimmed));
        }
    };
    for (i, c) in text.char_indices() {
        match (word_char(c), start) {
            (true, None) => start = Some(i),
            (false, Some(s)) => {
                flush(&mut out, s, i);
                start = None;
            }
            _ => {}
        }
    }
    if let Some(s) = start {
        flush(&mut out, s, text.len());
    }
    out
}

/// The figures of a token with no letters: maximal runs of digits with `,`
/// `.` and `-` between two digits.
pub fn figures(token: &str) -> Vec<String> {
    let chars: Vec<char> = token.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !is_decimal_digit(chars[i]) {
            i += 1;
            continue;
        }
        let mut run = String::new();
        while i < chars.len() {
            if is_decimal_digit(chars[i]) {
                run.push(chars[i]);
                i += 1;
            } else if matches!(chars[i], ',' | '.' | '-')
                && i + 1 < chars.len()
                && is_decimal_digit(chars[i + 1])
            {
                run.push(chars[i]);
                i += 1;
            } else {
                break;
            }
        }
        out.push(run);
    }
    out
}

fn has_digit(token: &str) -> bool {
    token.chars().any(is_decimal_digit)
}
fn has_letter(token: &str) -> bool {
    token.chars().any(char::is_alphabetic)
}

/// The closed identifier vocabulary of one version: every digit-bearing
/// token with a letter of the template (its name, ID and section IDs, titles
/// and text) and of the records the version pins (IDs, subjects, criterion
/// and basis IDs, fact names), each `LABEL digits` pair among them
/// (`ISA 315`), and the pure numbers that are themselves a pinned record's
/// identifier or subject (`000123`). A number in template text is never an
/// identifier: it would let a sentence state a figure no record holds.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Identifiers {
    named: BTreeSet<String>,
    numbers: BTreeSet<String>,
}
impl Identifiers {
    /// Template text: identifier tokens with a letter and `LABEL n` pairs.
    pub fn add(&mut self, text: &str) {
        self.insert(text, false);
    }
    /// A pinned record's identifier or subject: also a pure number.
    pub fn add_record(&mut self, text: &str) {
        self.insert(text, true);
    }
    fn insert(&mut self, text: &str, numbers: bool) {
        let list = tokens(text);
        for (index, (_, token)) in list.iter().enumerate() {
            if has_digit(token) && has_letter(token) {
                self.named.insert((*token).to_string());
            } else if numbers && has_digit(token) {
                self.numbers.insert((*token).to_string());
            }
            if let Some((offset, next)) = list.get(index + 1)
                && is_label(token)
                && is_number(next)
                && text[list[index].0 + token.len()..*offset] == *" "
            {
                self.named.insert(format!("{token} {next}"));
            }
        }
    }
    /// A named identifier (with a letter, or a `LABEL n` pair).
    pub fn contains(&self, token: &str) -> bool {
        self.named.contains(token)
    }
    /// A pure number that is a pinned record's identifier.
    pub fn contains_number(&self, token: &str) -> bool {
        self.numbers.contains(token)
    }
    pub fn is_empty(&self) -> bool {
        self.named.is_empty() && self.numbers.is_empty()
    }
}
fn is_label(token: &str) -> bool {
    (2..=8).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_uppercase())
}
fn is_number(token: &str) -> bool {
    !token.is_empty() && token.bytes().all(|b| b.is_ascii_digit())
}

/// The renderings of one asserted value a figure may equal.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Renderings(BTreeSet<String>);
impl Renderings {
    /// An exact count: plain (`1000`) and comma-grouped (`1,000`).
    pub fn count(&mut self, n: u64) {
        let plain = n.to_string();
        self.0.insert(grouped(&plain));
        self.0.insert(plain);
    }
    /// A canonical decimal (`-1250.00`): plain and grouped, with and
    /// without its sign.
    pub fn decimal(&mut self, canonical: &str) {
        let unsigned = canonical.strip_prefix('-').unwrap_or(canonical);
        let (whole, fraction) = match unsigned.split_once('.') {
            Some((w, f)) => (w, Some(f)),
            None => (unsigned, None),
        };
        let with = |w: String| match fraction {
            Some(f) => format!("{w}.{f}"),
            None => w,
        };
        self.0.insert(with(whole.to_string()));
        self.0.insert(with(grouped(whole)));
    }
    /// Every figure of a checked text (a date, an identifier, a verified
    /// quote): the same run of digits may be repeated in the sentence.
    pub fn text(&mut self, value: &str) {
        for (_, token) in tokens(value) {
            for figure in figures(token) {
                self.0.insert(figure);
            }
        }
    }
    pub fn contains(&self, figure: &str) -> bool {
        self.0.contains(figure)
    }
}
fn grouped(whole: &str) -> String {
    let digits: Vec<char> = whole.chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*c);
    }
    out
}

/// Whether the token at `index` is part of an identifier that resolves:
/// itself (when it has a letter, or `allow_numbers` and it is a pure number
/// the vocabulary names), or the number of a `LABEL number` pair.
fn resolves(
    list: &[(usize, &str)],
    text: &str,
    index: usize,
    identifiers: &Identifiers,
    allow_numbers: bool,
) -> bool {
    let (offset, token) = list[index];
    if (has_letter(token) && identifiers.contains(token))
        || (allow_numbers && identifiers.contains_number(token))
    {
        return true;
    }
    if index > 0 && is_number(token) {
        let (previous_offset, previous) = list[index - 1];
        if is_label(previous)
            && text[previous_offset + previous.len()..offset] == *" "
            && identifiers.contains(&format!("{previous} {token}"))
        {
            return true;
        }
    }
    false
}

/// A claim statement: every figure outside a resolving identifier is one of
/// the renderings. Err names the first figure (or unresolved token) that is
/// not.
pub fn statement_figures_v1(
    statement: &str,
    renderings: &Renderings,
    identifiers: &Identifiers,
) -> Result<(), String> {
    let list = tokens(statement);
    for (index, (_, token)) in list.iter().enumerate() {
        if !has_digit(token) || resolves(&list, statement, index, identifiers, true) {
            continue;
        }
        if has_letter(token) {
            return Err((*token).to_string());
        }
        for figure in figures(token) {
            if !renderings.contains(&figure) {
                return Err(figure);
            }
        }
    }
    // A digit outside every token (none: digits are alphanumeric).
    Ok(())
}

/// Narrative, judgment and heading text: no decimal digit outside an
/// identifier that resolves (a pure number never does). Err names the first
/// offending token.
pub fn narrative_figures(text: &str, identifiers: &Identifiers) -> Result<(), String> {
    let list = tokens(text);
    for (index, (_, token)) in list.iter().enumerate() {
        if has_digit(token) && !resolves(&list, text, index, identifiers, false) {
            return Err((*token).to_string());
        }
    }
    Ok(())
}

/// The first verdict word of a text, case-insensitive and whole.
pub fn verdict_word(text: &str) -> Option<String> {
    text.split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .find(|w| VERDICT_WORDS.contains(&w.as_str()))
}
