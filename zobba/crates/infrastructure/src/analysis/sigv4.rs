//! Minimal AWS Signature Version 4 for the analysis adapter: signed JSON API
//! requests (ECS) and presigned S3 object URLs. Verified against the published
//! AWS example vectors. Secrets never enter a Debug, log or error value.
use sha2::{Digest, Sha256};
use std::fmt::Write as _;

pub struct Credentials {
    pub access_key_id: String,
    secret_access_key: String,
    pub session_token: Option<String>,
    /// Unix time the signing session expires, when it is a temporary session.
    pub expires_at: Option<i64>,
}
impl Credentials {
    pub fn new(access_key_id: String, secret: String, session_token: Option<String>) -> Self {
        Self {
            access_key_id,
            secret_access_key: secret,
            session_token,
            expires_at: None,
        }
    }
    pub fn expiring(mut self, expires_at: Option<i64>) -> Self {
        self.expires_at = expires_at;
        self
    }
}
impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Credentials(..)")
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(out, "{b:02x}");
    }
    out
}
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}
/// RFC 2104 HMAC over SHA-256 (64-byte block).
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(message);
    let mut outer = Sha256::new();
    outer.update(block.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().into()
}
pub fn signing_key(secret: &str, date: &str, region: &str, service: &str) -> [u8; 32] {
    let k = hmac_sha256(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    let k = hmac_sha256(&k, region.as_bytes());
    let k = hmac_sha256(&k, service.as_bytes());
    hmac_sha256(&k, b"aws4_request")
}

/// AWS URI encoding: everything except unreserved characters; `/` is kept
/// only when encoding a path.
pub fn uri_encode(value: &str, path: bool) -> String {
    let mut out = String::new();
    for b in value.bytes() {
        if b.is_ascii_alphanumeric()
            || matches!(b, b'-' | b'_' | b'.' | b'~')
            || (path && b == b'/')
        {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

/// `yyyymmddThhmmssZ` for a Unix time, without a calendar dependency.
/// Strict `YYYY-MM-DDTHH:MM:SS[.fff]Z` (the form AWS credential providers
/// return) to Unix seconds.
pub fn parse_utc(value: &str) -> Option<i64> {
    let value = value.strip_suffix('Z')?;
    let (date, time) = value.split_once('T')?;
    let time = time.split_once('.').map_or(time, |(whole, fraction)| {
        if fraction.is_empty() || !fraction.bytes().all(|b| b.is_ascii_digit()) {
            ""
        } else {
            whole
        }
    });
    let number = |text: &str, len: usize| -> Option<i64> {
        (text.len() == len && text.bytes().all(|b| b.is_ascii_digit()))
            .then(|| text.parse().ok())
            .flatten()
    };
    let mut d = date.split('-');
    let (year, month, day) = (
        number(d.next()?, 4)?,
        number(d.next()?, 2)?,
        number(d.next()?, 2)?,
    );
    let mut t = time.split(':');
    let (hour, minute, second) = (
        number(t.next()?, 2)?,
        number(t.next()?, 2)?,
        number(t.next()?, 2)?,
    );
    if d.next().is_some()
        || t.next().is_some()
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 60
    {
        return None;
    }
    // Howard Hinnant's days-from-civil.
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

pub fn amz_date(unix: i64) -> String {
    let days = unix.div_euclid(86_400);
    let seconds = unix.rem_euclid(86_400);
    // Howard Hinnant's civil-from-days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    if month <= 2 {
        year += 1;
    }
    format!(
        "{year:04}{month:02}{day:02}T{:02}{:02}{:02}Z",
        seconds / 3600,
        (seconds % 3600) / 60,
        seconds % 60
    )
}

pub struct Scope<'a> {
    pub region: &'a str,
    pub service: &'a str,
}

fn canonical_query(pairs: &mut [(String, String)]) -> String {
    pairs.sort();
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", uri_encode(k, false), uri_encode(v, false)))
        .collect::<Vec<_>>()
        .join("&")
}

/// Sign a request with headers. `headers` must contain `host`; names are
/// lower-cased. Returns the Authorization header value.
#[allow(clippy::too_many_arguments)]
pub fn authorization(
    credentials: &Credentials,
    scope: &Scope<'_>,
    method: &str,
    path: &str,
    query: &mut [(String, String)],
    headers: &[(String, String)],
    payload: &[u8],
    date: &str,
) -> String {
    let mut headers: Vec<(String, String)> = headers
        .iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v.trim().to_owned()))
        .collect();
    headers.sort();
    let signed = headers
        .iter()
        .map(|(k, _)| k.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_headers: String = headers.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let request = format!(
        "{method}\n{}\n{}\n{canonical_headers}\n{signed}\n{}",
        uri_encode(path, true),
        canonical_query(query),
        sha256_hex(payload)
    );
    let day = &date[..8];
    let credential_scope = format!("{day}/{}/{}/aws4_request", scope.region, scope.service);
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{date}\n{credential_scope}\n{}",
        sha256_hex(request.as_bytes())
    );
    let key = signing_key(
        &credentials.secret_access_key,
        day,
        scope.region,
        scope.service,
    );
    format!(
        "AWS4-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={signed}, Signature={}",
        credentials.access_key_id,
        hex(&hmac_sha256(&key, to_sign.as_bytes()))
    )
}

/// Presigned S3 URL query (host-only signed headers, unsigned payload).
pub fn presign_query(
    credentials: &Credentials,
    scope: &Scope<'_>,
    method: &str,
    host: &str,
    path: &str,
    date: &str,
    expires_seconds: u32,
) -> String {
    let day = &date[..8];
    let credential_scope = format!("{day}/{}/{}/aws4_request", scope.region, scope.service);
    let mut query = vec![
        ("X-Amz-Algorithm".to_owned(), "AWS4-HMAC-SHA256".to_owned()),
        (
            "X-Amz-Credential".to_owned(),
            format!("{}/{credential_scope}", credentials.access_key_id),
        ),
        ("X-Amz-Date".to_owned(), date.to_owned()),
        ("X-Amz-Expires".to_owned(), expires_seconds.to_string()),
        ("X-Amz-SignedHeaders".to_owned(), "host".to_owned()),
    ];
    if let Some(token) = &credentials.session_token {
        query.push(("X-Amz-Security-Token".to_owned(), token.clone()));
    }
    let canonical = canonical_query(&mut query);
    let request = format!(
        "{method}\n{}\n{canonical}\nhost:{host}\n\nhost\nUNSIGNED-PAYLOAD",
        uri_encode(path, true)
    );
    let to_sign = format!(
        "AWS4-HMAC-SHA256\n{date}\n{credential_scope}\n{}",
        sha256_hex(request.as_bytes())
    );
    let key = signing_key(
        &credentials.secret_access_key,
        day,
        scope.region,
        scope.service,
    );
    format!(
        "{canonical}&X-Amz-Signature={}",
        hex(&hmac_sha256(&key, to_sign.as_bytes()))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_expiration_parses_exactly() {
        assert_eq!(parse_utc("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_utc("2026-10-13T20:00:00Z"), Some(1_791_921_600));
        assert_eq!(parse_utc("2026-10-13T20:00:00.123Z"), Some(1_791_921_600));
        assert_eq!(
            amz_date(parse_utc("2015-08-30T12:36:00Z").unwrap()),
            "20150830T123600Z"
        );
        for bad in [
            "2026-10-13 20:00:00Z",
            "2026-13-01T00:00:00Z",
            "2026-10-13T20:00:00",
            "",
        ] {
            assert_eq!(parse_utc(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn signing_key_and_request_signature_match_the_aws_example() {
        assert_eq!(
            hex(&signing_key(
                "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
                "20150830",
                "us-east-1",
                "iam"
            )),
            "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9"
        );
        let credentials = Credentials::new(
            "AKIDEXAMPLE".into(),
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY".into(),
            None,
        );
        let header = authorization(
            &credentials,
            &Scope {
                region: "us-east-1",
                service: "iam",
            },
            "GET",
            "/",
            &mut [
                ("Version".into(), "2010-05-08".into()),
                ("Action".into(), "ListUsers".into()),
            ],
            &[
                (
                    "Content-Type".into(),
                    "application/x-www-form-urlencoded; charset=utf-8".into(),
                ),
                ("Host".into(), "iam.amazonaws.com".into()),
                ("X-Amz-Date".into(), "20150830T123600Z".into()),
            ],
            b"",
            "20150830T123600Z",
        );
        assert_eq!(
            header,
            "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7"
        );
        assert_eq!(format!("{credentials:?}"), "Credentials(..)");
    }

    #[test]
    fn presigned_url_matches_the_aws_s3_example() {
        let credentials = Credentials::new(
            "AKIAIOSFODNN7EXAMPLE".into(),
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".into(),
            None,
        );
        let query = presign_query(
            &credentials,
            &Scope {
                region: "us-east-1",
                service: "s3",
            },
            "GET",
            "examplebucket.s3.amazonaws.com",
            "/test.txt",
            "20130524T000000Z",
            86_400,
        );
        assert!(query.ends_with(
            "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"
        ));
    }

    #[test]
    fn dates_and_encoding_are_exact() {
        assert_eq!(amz_date(0), "19700101T000000Z");
        assert_eq!(amz_date(1_440_938_160), "20150830T123600Z");
        assert_eq!(amz_date(951_782_400), "20000229T000000Z");
        assert_eq!(uri_encode("a b/c+~", true), "a%20b/c%2B~");
        assert_eq!(uri_encode("a/b", false), "a%2Fb");
        // RFC 4231 test case 2.
        assert_eq!(
            hex(&hmac_sha256(b"Jefe", b"what do ya want for nothing?")),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }
}
