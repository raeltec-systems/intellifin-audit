//! Rule `statement_figures_v2` (review round 1 of Story 24.4, owner decisions
//! of 2026-10-21): every figure of a claim's sentence is one of the values its
//! checked assertions hold, and the title, headings, narrative and judgment
//! text carry no figure at all.
//!
//! A figure is any number a reader sees:
//! - a run of numeric characters (every Unicode `Nd` digit, and every `Nl`
//!   and `No` character: Roman numeral characters, superscripts, circled and
//!   fraction numerals), by the Unicode tables of the Rust standard library
//!   this build uses (`char::is_numeric`), with `,` `.` grouping/decimal and
//!   `-` date separators between them, and its sign;
//! - a number word or phrase ("fourteen", "twenty-one", "one thousand");
//! - a Roman numeral of two or more upper-case letters (`XIV`);
//! - a date written as `31 January 2026`, `January 31, 2026`, `31/12/2026`,
//!   `31.12.2026`, `2026/12/31` or `2026-12-31`, and a year beside a month or
//!   a word such as "in" or "FY".
//!
//! The only numbers allowed outside a figure are inside a closed identifier
//! token that resolves to a record or template section the version names
//! (`A1`, `ISA 315`, `FY2025`, `INV-0042`); a pure number resolves only in a
//! claim, only when it is the subject of one of that claim's own records, and
//! only after a word that names it ("invoice 000123"). Characters that change
//! how text is displayed without being seen (bidirectional controls,
//! zero-width characters) are refused outright, so the text checked is the
//! text a reader sees. Pure and deterministic.
use std::collections::BTreeSet;

/// Whether a character states a number (Unicode `Nd`, `Nl` or `No`).
pub fn is_numeric(c: char) -> bool {
    c.is_numeric()
}

/// Whether a character changes how text displays without being visible: the
/// soft hyphen, bidirectional embedding, override and isolate controls,
/// zero-width spaces and joiners, word joiners and invisible operators,
/// variation selectors, the byte order mark, interlinear annotation and tag
/// characters, and the Hangul fillers.
pub fn hidden_character(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x034F | 0x061C | 0x115F | 0x1160 | 0x17B4 | 0x17B5
        | 0x180B..=0x180F | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x206F
        | 0x3164 | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF9..=0xFFFB
        | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF)
}
/// The first hidden character of a text.
pub fn first_hidden(text: &str) -> Option<char> {
    text.chars().find(|c| hidden_character(*c))
}

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

/// The figures of a token: maximal runs of numeric characters with `,` `.`
/// and `-` between two of them.
pub fn figures(token: &str) -> Vec<String> {
    let chars: Vec<char> = token.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if !is_numeric(chars[i]) {
            i += 1;
            continue;
        }
        let mut run = String::new();
        while i < chars.len() {
            // A numeral, or a separator followed by a numeral, continues it.
            let separator = matches!(chars[i], ',' | '.' | '-')
                && i + 1 < chars.len()
                && is_numeric(chars[i + 1]);
            if !(is_numeric(chars[i]) || separator) {
                break;
            }
            run.push(chars[i]);
            i += 1;
        }
        out.push(run);
    }
    out
}

fn has_numeral(token: &str) -> bool {
    token.chars().any(is_numeric)
}
fn has_letter(token: &str) -> bool {
    token.chars().any(char::is_alphabetic)
}
fn is_number(token: &str) -> bool {
    !token.is_empty() && token.bytes().all(|b| b.is_ascii_digit())
}
fn is_word(token: &str) -> bool {
    !token.is_empty() && token.chars().all(char::is_alphabetic)
}
/// An identifier label: two to eight upper-case ASCII letters (`ISA`).
fn is_label(token: &str) -> bool {
    (2..=8).contains(&token.len()) && token.bytes().all(|b| b.is_ascii_uppercase())
}

// ---------------------------------------------------------- number words

const UNITS: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const TENS: [&str; 8] = [
    "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
const SCALES: [(&str, u64); 4] = [
    ("thousand", 1_000),
    ("million", 1_000_000),
    ("billion", 1_000_000_000),
    ("trillion", 1_000_000_000_000),
];

fn simple_number_word(word: &str) -> Option<u64> {
    if let Some(i) = UNITS.iter().position(|u| *u == word) {
        return Some(i as u64);
    }
    if let Some(i) = TENS.iter().position(|t| *t == word) {
        return Some(20 + 10 * i as u64);
    }
    None
}
/// Whether a token is a number word (`fourteen`, `twenty-one`, `hundred`,
/// `thousand`, `dozen`), case-insensitive.
pub fn number_word(token: &str) -> bool {
    let lower = token.to_lowercase();
    lower.split('-').all(|part| {
        simple_number_word(part).is_some()
            || part == "hundred"
            || part == "dozen"
            || SCALES.iter().any(|(s, _)| *s == part)
    }) && !lower.is_empty()
}
/// The value of a run of number words (`one thousand two hundred and five`;
/// `a` before a scale is one). None when the words do not form a number.
pub fn number_words_value(words: &[&str]) -> Option<u64> {
    let (mut total, mut current) = (0u64, 0u64);
    let mut seen = false;
    for (i, word) in words.iter().enumerate() {
        let lower = word.to_lowercase();
        if lower == "and" && seen {
            continue;
        }
        if lower == "a" && i + 1 < words.len() {
            current = current.max(1);
            continue;
        }
        for part in lower.split('-') {
            if let Some(v) = simple_number_word(part) {
                current = current.checked_add(v)?;
            } else if part == "hundred" {
                current = current.max(1).checked_mul(100)?;
            } else if part == "dozen" {
                current = current.max(1).checked_mul(12)?;
            } else if let Some((_, scale)) = SCALES.iter().find(|(s, _)| *s == part) {
                total = total.checked_add(current.max(1).checked_mul(*scale)?)?;
                current = 0;
            } else {
                return None;
            }
            seen = true;
        }
    }
    seen.then_some(total.checked_add(current)?)
}

/// The value of a Roman numeral of two or more upper-case letters in its
/// canonical form (`XIV` is 14; `IIII` and `IC` are not numerals).
pub fn roman(token: &str) -> Option<u64> {
    if token.len() < 2 || !token.bytes().all(|b| b"IVXLCDM".contains(&b)) {
        return None;
    }
    let value = |b: u8| match b {
        b'I' => 1,
        b'V' => 5,
        b'X' => 10,
        b'L' => 50,
        b'C' => 100,
        b'D' => 500,
        _ => 1000,
    };
    let bytes = token.as_bytes();
    // A simple, exact evaluation (subtractive pairs), then the canonical
    // rendering must give back the same letters.
    let mut sum: i64 = 0;
    for (i, b) in bytes.iter().enumerate() {
        let v = value(*b) as i64;
        if bytes.get(i + 1).is_some_and(|n| value(*n) as i64 > v) {
            sum -= v;
        } else {
            sum += v;
        }
    }
    let n = u64::try_from(sum).ok().filter(|n| (1..=3999).contains(n))?;
    (render_roman(n) == token).then_some(n)
}
fn render_roman(mut n: u64) -> String {
    const TABLE: [(u64, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (v, s) in TABLE {
        while n >= v {
            out.push_str(s);
            n -= v;
        }
    }
    out
}

// ----------------------------------------------------------------- dates

const MONTHS: [&str; 12] = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];
fn month(token: &str) -> Option<u32> {
    let lower = token.to_lowercase();
    MONTHS
        .iter()
        .position(|m| {
            *m == lower
                || (lower.len() == 3 && m.starts_with(&lower))
                || (lower == "sept" && *m == "september")
        })
        .map(|i| i as u32 + 1)
}
fn valid_date(y: i32, m: u32, d: u32) -> bool {
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&d) && (1000..=9999).contains(&y)
}
/// An ISO calendar date `YYYY-MM-DD`.
pub fn iso_date(value: &str) -> Option<(i32, u32, u32)> {
    let b = value.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y: i32 = value.get(0..4)?.parse().ok()?;
    let m: u32 = value.get(5..7)?.parse().ok()?;
    let d: u32 = value.get(8..10)?.parse().ok()?;
    (is_number(&value[0..4])
        && is_number(&value[5..7])
        && is_number(&value[8..10])
        && valid_date(y, m, d))
    .then_some((y, m, d))
}
fn day(token: &str) -> Option<u32> {
    (is_number(token) && token.len() <= 2)
        .then(|| token.parse().ok())
        .flatten()
        .filter(|d| (1..=31).contains(d))
}
fn year(token: &str) -> Option<i32> {
    (is_number(token) && token.len() == 4)
        .then(|| token.parse().ok())
        .flatten()
}
/// A one-token date in a separated form: `31/12/2026`, `31.12.2026` (day,
/// month, year), `2026/12/31` or `2026.12.31`.
fn separated_date(token: &str) -> Option<(i32, u32, u32)> {
    for sep in ['/', '.'] {
        let parts: Vec<&str> = token.split(sep).collect();
        if parts.len() != 3 || !parts.iter().all(|p| is_number(p)) {
            continue;
        }
        let (y, m, d) = if parts[0].len() == 4 {
            (parts[0], parts[1], parts[2])
        } else {
            (parts[2], parts[1], parts[0])
        };
        if y.len() == 4 && (1..=2).contains(&m.len()) && (1..=2).contains(&d.len()) {
            let (y, m, d) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
            if valid_date(y, m, d) {
                return Some((y, m, d));
            }
        }
    }
    None
}

/// What a date expression at a token names: a whole date, or a month of a
/// year; and how many tokens it spans.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DateRef {
    Day(i32, u32, u32),
    Month(i32, u32),
}
fn date_at(list: &[(usize, &str)], i: usize) -> Option<(usize, DateRef)> {
    let t = |k: usize| list.get(i + k).map(|(_, t)| *t);
    if let Some(date) = t(0).and_then(separated_date) {
        return Some((1, DateRef::Day(date.0, date.1, date.2)));
    }
    // 31 January 2026
    if let (Some(d), Some(m), Some(y)) = (
        t(0).and_then(day),
        t(1).and_then(month),
        t(2).and_then(year),
    ) && valid_date(y, m, d)
    {
        return Some((3, DateRef::Day(y, m, d)));
    }
    // January 31, 2026
    if let (Some(m), Some(d), Some(y)) = (
        t(0).and_then(month),
        t(1).and_then(day),
        t(2).and_then(year),
    ) && valid_date(y, m, d)
    {
        return Some((3, DateRef::Day(y, m, d)));
    }
    // January 2026
    if let (Some(m), Some(y)) = (t(0).and_then(month), t(1).and_then(year)) {
        return Some((2, DateRef::Month(y, m)));
    }
    None
}

/// Words after which a four-digit year is a year ("in 2026", "FY 2026").
const YEAR_WORDS: [&str; 12] = [
    "in", "during", "year", "fy", "cy", "fiscal", "calendar", "since", "until", "through", "for",
    "of",
];

// ------------------------------------------------------------ identifiers

/// The closed identifier vocabulary of one version: every token with a
/// letter and a numeral of the template (its name, ID, section IDs and
/// titles) and of the records the version pins (IDs, subjects, criterion and
/// basis IDs), each `LABEL number` pair among them (`ISA 315`), matched
/// case-insensitively, and the number words and Roman numerals of the
/// template's own text (a section titled "Part II"). A pure number is never a
/// version-wide identifier: it resolves only inside a claim whose own record
/// it is (see [`statement_figures_v2`]).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Identifiers {
    named: BTreeSet<String>,
    words: BTreeSet<String>,
}
impl Identifiers {
    /// Template text: identifier tokens, `LABEL n` pairs, and its own
    /// number words and Roman numerals.
    pub fn add(&mut self, text: &str) {
        self.insert(text, true);
    }
    /// A pinned record's identifier or subject (a token with a letter).
    pub fn add_record(&mut self, text: &str) {
        self.insert(text, false);
    }
    fn insert(&mut self, text: &str, template: bool) {
        let list = tokens(text);
        for (index, (_, token)) in list.iter().enumerate() {
            if has_numeral(token) && has_letter(token) {
                self.named.insert(token.to_lowercase());
            }
            if template && (number_word(token) || roman(token).is_some()) {
                self.words.insert(token.to_lowercase());
            }
            if let Some((offset, next)) = list.get(index + 1)
                && is_label(token)
                && is_number(next)
                && text[list[index].0 + token.len()..*offset] == *" "
            {
                self.named.insert(format!("{token} {next}").to_lowercase());
            }
        }
    }
    /// A named identifier (with a letter, or a `LABEL n` pair).
    pub fn contains(&self, token: &str) -> bool {
        self.named.contains(&token.to_lowercase())
    }
    /// A number word or Roman numeral the template's own text uses.
    pub fn template_word(&self, token: &str) -> bool {
        self.words.contains(&token.to_lowercase())
    }
    pub fn is_empty(&self) -> bool {
        self.named.is_empty() && self.words.is_empty()
    }
}

/// The renderings of the values a claim asserts, which its figures may be.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Renderings {
    figures: BTreeSet<String>,
    dates: BTreeSet<(i32, u32, u32)>,
}
impl Renderings {
    /// An exact count: plain (`1000`), comma-grouped (`1,000`) and grouped
    /// by a space, a no-break space or a narrow no-break space.
    pub fn count(&mut self, n: u64) {
        let plain = n.to_string();
        self.insert_grouped(&plain, None);
    }
    fn insert_grouped(&mut self, whole: &str, fraction: Option<&str>) {
        let with = |w: String| match fraction {
            Some(f) => format!("{w}.{f}"),
            None => w,
        };
        self.figures.insert(with(whole.to_string()));
        for sep in [",", " ", "\u{a0}", "\u{202f}"] {
            self.figures.insert(with(grouped_by(whole, sep)));
        }
    }
    /// A canonical decimal (`-1250.00`): plain and grouped, with its own
    /// sign only (a negative value is stated negative, a positive one never).
    pub fn decimal(&mut self, canonical: &str) {
        let (negative, unsigned) = match canonical.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, canonical),
        };
        let (whole, fraction) = match unsigned.split_once('.') {
            Some((w, f)) => (w, Some(f)),
            None => (unsigned, None),
        };
        if negative {
            let mut signed = Renderings::default();
            signed.insert_grouped(whole, fraction);
            for f in signed.figures {
                self.figures.insert(format!("-{f}"));
            }
        } else {
            self.insert_grouped(whole, fraction);
        }
    }
    /// Every figure of a checked text (a date, an identifier, a verified
    /// quote) and every ISO date in it: the same run of digits or the same
    /// date may be repeated in the sentence, in any written date form.
    pub fn text(&mut self, value: &str) {
        for (_, token) in tokens(value) {
            for figure in figures(token) {
                if let Some(date) = iso_date(&figure) {
                    self.dates.insert(date);
                }
                self.figures.insert(figure);
            }
        }
    }
    pub fn contains(&self, figure: &str) -> bool {
        self.figures.contains(figure)
    }
    fn has_date(&self, date: DateRef) -> bool {
        match date {
            DateRef::Day(y, m, d) => self.dates.contains(&(y, m, d)),
            DateRef::Month(y, m) => self.dates.iter().any(|(dy, dm, _)| *dy == y && *dm == m),
        }
    }
    fn has_year(&self, y: i32) -> bool {
        self.dates.iter().any(|(dy, _, _)| *dy == y)
    }
}
fn grouped_by(whole: &str, sep: &str) -> String {
    let digits: Vec<char> = whole.chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push_str(sep);
        }
        out.push(*c);
    }
    out
}

/// Whether the token at `index` is part of an identifier that resolves:
/// itself (a token with a letter the vocabulary names), the number of a
/// `LABEL number` pair, or, in a claim, a pure number that is one of the
/// claim's own records' subjects written right after a word ("invoice
/// 000123", "employee #250").
fn resolves(
    list: &[(usize, &str)],
    text: &str,
    index: usize,
    identifiers: &Identifiers,
    own: Option<&BTreeSet<String>>,
) -> bool {
    let (offset, token) = list[index];
    if has_letter(token) && identifiers.contains(token) {
        return true;
    }
    if index > 0 && is_number(token) {
        let (previous_offset, previous) = list[index - 1];
        let gap = &text[previous_offset + previous.len()..offset];
        if is_label(&previous.to_uppercase())
            && gap == " "
            && identifiers.contains(&format!("{previous} {token}"))
        {
            return true;
        }
        if let Some(own) = own
            && own.contains(token)
            && is_word(previous)
            && !number_word(previous)
            && month(previous).is_none()
            && matches!(gap, " " | " #" | " no. " | " No. " | " nr " | ": ")
        {
            return true;
        }
    }
    false
}

/// The sign written right before a token: `-` or `−` after a space, an
/// opening bracket or the start of the text.
fn negative_before(text: &str, offset: usize) -> bool {
    let mut before = text[..offset].chars().rev();
    matches!(before.next(), Some('-' | '\u{2212}'))
        && before
            .next()
            .is_none_or(|c| c.is_whitespace() || matches!(c, '(' | '[' | ':'))
}

/// A claim statement: every figure outside a resolving identifier is one of
/// the renderings. `own` holds the pure-number subjects of the claim's own
/// records. Err names the first figure (or unresolved token) that is not.
pub fn statement_figures_v2(
    statement: &str,
    renderings: &Renderings,
    identifiers: &Identifiers,
    own: &BTreeSet<String>,
) -> Result<(), String> {
    if let Some(c) = first_hidden(statement) {
        return Err(format!("U+{:04X}", c as u32));
    }
    let list = tokens(statement);
    let mut i = 0;
    while i < list.len() {
        let (offset, token) = list[i];
        if let Some((span, date)) = date_at(&list, i) {
            if !renderings.has_date(date) {
                let end = list[i + span - 1].0 + list[i + span - 1].1.len();
                return Err(statement[offset..end].to_string());
            }
            i += span;
            continue;
        }
        let no_one =
            token.eq_ignore_ascii_case("one") && i > 0 && list[i - 1].1.eq_ignore_ascii_case("no");
        if number_word(token) && !no_one {
            // A maximal run of number words (with `and` and `a` inside).
            let mut j = i + 1;
            while j < list.len()
                && (number_word(list[j].1)
                    || (list[j].1.eq_ignore_ascii_case("and")
                        && list.get(j + 1).is_some_and(|(_, n)| number_word(n))))
            {
                j += 1;
            }
            // `a hundred`, `a thousand`, `a dozen`: the `a` is one.
            let scale = simple_number_word(&token.to_lowercase()).is_none();
            let start = if i > 0 && scale && list[i - 1].1.eq_ignore_ascii_case("a") {
                i - 1
            } else {
                i
            };
            let words: Vec<&str> = list[start..j].iter().map(|(_, t)| *t).collect();
            let phrase = &statement[list[start].0..list[j - 1].0 + list[j - 1].1.len()];
            match number_words_value(&words) {
                Some(v) if renderings.contains(&v.to_string()) => {}
                _ if words.len() == 1 && identifiers.template_word(token) => {}
                _ => return Err(phrase.to_string()),
            }
            i = j;
            continue;
        }
        if let Some(v) = roman(token) {
            if !renderings.contains(&v.to_string()) && !identifiers.template_word(token) {
                return Err(token.to_string());
            }
            i += 1;
            continue;
        }
        if no_one || !has_numeral(token) || resolves(&list, statement, i, identifiers, Some(own)) {
            i += 1;
            continue;
        }
        if has_letter(token) {
            // FY2026 / CY2026: a year of a pinned date.
            let lower = token.to_lowercase();
            if let Some(y) = ["fy", "cy"]
                .iter()
                .find_map(|p| lower.strip_prefix(p))
                .and_then(year)
                && renderings.has_year(y)
            {
                i += 1;
                continue;
            }
            return Err(token.to_string());
        }
        // A year of a pinned date, after a word that makes it a year.
        if let Some(y) = year(token)
            && renderings.has_year(y)
            && i > 0
            && (month(list[i - 1].1).is_some()
                || YEAR_WORDS.contains(&list[i - 1].1.to_lowercase().as_str()))
        {
            i += 1;
            continue;
        }
        // A count grouped by spaces: `1 000`.
        if is_number(token) && token.len() <= 3 {
            let mut j = i;
            let mut merged = token.to_string();
            let mut matched = None;
            while let Some((next_offset, next)) = list.get(j + 1) {
                let gap = &statement[list[j].0 + list[j].1.len()..*next_offset];
                if next.len() != 3
                    || !is_number(next)
                    || !matches!(gap, " " | "\u{a0}" | "\u{202f}")
                {
                    break;
                }
                merged = format!("{merged}{gap}{next}");
                j += 1;
                if renderings.contains(&merged) {
                    matched = Some(j);
                }
            }
            if let Some(end) = matched {
                i = end + 1;
                continue;
            }
        }
        for (k, figure) in figures(token).into_iter().enumerate() {
            let figure = if k == 0 && negative_before(statement, offset) {
                format!("-{figure}")
            } else {
                figure
            };
            if !renderings.contains(&figure) {
                return Err(figure);
            }
        }
        i += 1;
    }
    Ok(())
}

/// The title, a heading, narrative and judgment text: no figure of any kind
/// outside an identifier that resolves (a pure number never does). Err names
/// the first offending token.
pub fn narrative_figures(text: &str, identifiers: &Identifiers) -> Result<(), String> {
    if let Some(c) = first_hidden(text) {
        return Err(format!("U+{:04X}", c as u32));
    }
    let list = tokens(text);
    for (index, (_, token)) in list.iter().enumerate() {
        if has_numeral(token) && !resolves(&list, text, index, identifiers, None) {
            return Err((*token).to_string());
        }
        let no_one = token.eq_ignore_ascii_case("one")
            && index > 0
            && list[index - 1].1.eq_ignore_ascii_case("no");
        if (number_word(token) && !no_one || roman(token).is_some())
            && !identifiers.template_word(token)
        {
            return Err((*token).to_string());
        }
    }
    Ok(())
}

// --------------------------------------------------------------- verdicts

/// What a verdict word of a sentence says.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum VerdictClass {
    /// Met, passed, compliant, effective, no exceptions.
    Positive,
    /// Not met, failed, exception(s), deficiency, breach.
    Negative,
    /// Inconclusive, undetermined, execution failed.
    Undetermined,
}

const POSITIVE: &[&str] = &[
    "met",
    "meet",
    "meets",
    "pass",
    "passed",
    "passes",
    "passing",
    "compliant",
    "effective",
    "satisfactory",
];
const NEGATIVE: &[&str] = &[
    "unmet",
    "fail",
    "failed",
    "fails",
    "failing",
    "failure",
    "failures",
    "noncompliant",
    "noncompliance",
    "ineffective",
    "deficiency",
    "deficiencies",
    "deficient",
    "breach",
    "breaches",
    "breached",
    "unsatisfactory",
    "exception",
    "exceptions",
];
const UNDETERMINED: &[&str] = &["inconclusive", "undetermined", "indeterminate"];
/// Words that negate a verdict word up to three words after them.
const NEGATORS: &[&str] = &[
    "not", "no", "never", "without", "nor", "cannot", "non", "didn", "doesn", "don", "wasn",
    "weren", "isn", "aren", "hasn", "haven", "hadn", "wouldn", "couldn", "shouldn", "none",
];

/// The closed verdict words of a sentence, case-insensitive and whole, each
/// with what it says after negation ("not met" is negative, "no exceptions"
/// positive, "execution failed" undetermined).
pub fn verdicts(text: &str) -> Vec<(VerdictClass, String)> {
    let words: Vec<String> = text
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
        .collect();
    let mut out = Vec::new();
    for (i, word) in words.iter().enumerate() {
        let w = word.as_str();
        let mut class = if POSITIVE.contains(&w) {
            VerdictClass::Positive
        } else if NEGATIVE.contains(&w) {
            VerdictClass::Negative
        } else if UNDETERMINED.contains(&w) {
            VerdictClass::Undetermined
        } else {
            continue;
        };
        let previous = |k: usize| (i >= k).then(|| words[i - k].as_str());
        if class == VerdictClass::Negative
            && matches!(w, "failed" | "fails" | "failing" | "failure" | "failures")
            && matches!(previous(1), Some("execution" | "executions"))
        {
            class = VerdictClass::Undetermined;
        }
        let negated = (1..=3).any(|k| previous(k).is_some_and(|p| NEGATORS.contains(&p)));
        let class = match (class, negated) {
            (VerdictClass::Positive, true) => VerdictClass::Negative,
            (VerdictClass::Negative, true) => VerdictClass::Positive,
            (c, _) => c,
        };
        let phrase = match (1..=3).rev().find_map(|k| {
            previous(k)
                .filter(|p| NEGATORS.contains(p))
                .map(|_| words[i - k..=i].join(" "))
        }) {
            Some(p) if negated => p,
            _ => word.clone(),
        };
        out.push((class, phrase));
    }
    out
}

/// The first verdict word of a text, case-insensitive and whole.
pub fn verdict_word(text: &str) -> Option<String> {
    verdicts(text).into_iter().next().map(|(_, w)| w)
}
