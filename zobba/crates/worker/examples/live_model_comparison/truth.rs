//! The known truth of the fixed synthetic engagement, kept in the harness so
//! results can be scored. The rules are those of
//! `zobba/fixtures/documents/generate.py` (which made the committed bytes);
//! the population counts are checked at start against the generator's own
//! independently computed `AP population expected.json`.
use std::collections::BTreeSet;
use std::path::Path;

/// One invoice row of `AP invoices.xlsx` Sheet1 (`ap_invoices()` in
/// generate.py): (invoice, amount, currency, approver).
pub const LISTING: &[(&str, u32, &str, &str)] = &[
    ("INV-0042", 1250, "USD", "J. Smith"),
    ("000123", 980, "USD", "J. Smith"),
    ("INV-0054", 1250, "USD", ""),
    ("INV-0055", 4200, "EUR", "A. Jones"),
    ("INV-0050", 1250, "USD", "J. Smith"),
    ("INV-0051", 1250, "USD", ""),
    ("INV-0052", 1250, "USD", ""),
    ("INV-0053", 1250, "USD", "J. Smith"),
    ("INV-0057", 3000, "EUR", "A. Jones"),
];

pub const ROLES_FILE: &str = "AP approval roles 2026.txt";

pub struct Truth {
    /// Population invoices dated 2026, above 1,000.00 USD, Approved = No.
    pub population_not_approved: BTreeSet<String>,
    /// Population invoices dated 2026, above 1,000.00 USD, approved before
    /// payment = No.
    pub population_after_payment: BTreeSet<String>,
    /// Applicable population invoices whose evidence cannot decide a
    /// criterion (Approved = Pending, or approved before payment = Unknown):
    /// correctly undetermined, never an exception.
    pub population_undetermined: BTreeSet<String>,
    /// Every distinct population invoice.
    pub population_all: BTreeSet<String>,
    /// Listing invoices above 1,000.00 USD with no approver.
    pub listing_missing_approver: BTreeSet<String>,
    /// Listing invoices approved by the person who requested them (roles
    /// document, rule AP-2).
    pub listing_segregation: BTreeSet<String>,
    /// Listing invoices whose requester and approver differ.
    pub listing_segregation_pass: BTreeSet<String>,
    pub listing_all: BTreeSet<String>,
    /// The generator's expected population counts, as committed.
    pub expected: serde_json::Value,
    /// Words of the data-quality facts a careful auditor would state.
    pub data_quality: Vec<(&'static str, &'static str, Vec<&'static str>)>,
}

fn inv(i: u32) -> String {
    format!("INV-{i:05}")
}

impl Truth {
    pub fn load(repo: &Path, roles: &Path) -> Result<Self, String> {
        let population_all: BTreeSet<String> = (1..=1250).map(inv).collect();
        let population_not_approved: BTreeSet<String> = (251..=265).map(inv).collect();
        let population_after_payment: BTreeSet<String> = (259..=270).map(inv).collect();
        let population_undetermined: BTreeSet<String> = (276..=295).map(inv).collect();
        let listing_all: BTreeSet<String> = LISTING.iter().map(|r| r.0.to_string()).collect();
        let listing_missing_approver: BTreeSet<String> = LISTING
            .iter()
            .filter(|r| r.2 == "USD" && r.1 > 1000 && r.3.is_empty())
            .map(|r| r.0.to_string())
            .collect();
        // Requesters from the harness's own roles document.
        let text = std::fs::read_to_string(roles)
            .map_err(|e| format!("cannot read {}: {e}", roles.display()))?;
        let mut requesters = Vec::new();
        for line in text.lines() {
            if let Some((invoice, rest)) = line.split_once(" was requested by ") {
                requesters.push((invoice.trim().to_string(), rest.trim().trim_end_matches('.').to_string()));
            }
        }
        if requesters.len() != 8 {
            return Err(format!("the roles document names {} requesters, the truth expects 8", requesters.len()));
        }
        let mut listing_segregation = BTreeSet::new();
        let mut listing_segregation_pass = BTreeSet::new();
        for (invoice, requester) in &requesters {
            let Some(row) = LISTING.iter().find(|r| r.0 == invoice.as_str()) else {
                return Err(format!("the roles document names {invoice}, which the listing does not hold"));
            };
            if row.3.is_empty() {
                continue;
            }
            if row.3 == requester.as_str() {
                listing_segregation.insert(invoice.clone());
            } else {
                listing_segregation_pass.insert(invoice.clone());
            }
        }

        // Cross-check the population rules against the generator's own counts.
        let path = repo.join("zobba/fixtures/documents/AP population expected.json");
        let expected: serde_json::Value = serde_json::from_slice(
            &std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?,
        )
        .map_err(|e| format!("{} is not JSON: {e}", path.display()))?;
        let failing: BTreeSet<&String> = population_not_approved
            .union(&population_after_payment)
            .collect();
        let checks: [(&str, &serde_json::Value, usize); 9] = [
            ("distinct_subjects", &expected["distinct_subjects"], population_all.len()),
            ("applicable", &expected["applicable"], (251..=1250).count()),
            ("in_scope", &expected["in_scope"], (51..=1250).count()),
            ("excluded_out_of_period", &expected["excluded_out_of_period"], (1..=50).count()),
            ("a.not_met", &expected["a"]["not_met"], population_not_approved.len()),
            ("b.not_met", &expected["b"]["not_met"], population_after_payment.len()),
            ("a.undetermined", &expected["a"]["undetermined"], (276..=285).count()),
            ("b.undetermined", &expected["b"]["undetermined"], (286..=295).count()),
            ("failing", &expected["failing"], failing.len()),
        ];
        for (name, stated, computed) in checks {
            if stated.as_u64() != Some(computed as u64) {
                return Err(format!(
                    "the harness truth disagrees with the generator's {name}: {stated} vs {computed}"
                ));
            }
        }
        if expected["duplicate_rows"].as_u64() != Some(6)
            || expected["conclusion"].as_str() != Some("exceptions_found_inconclusive")
        {
            return Err("the generator's expected duplicates or conclusion changed".into());
        }
        if listing_missing_approver.len() != 3 || listing_segregation.len() != 3 || listing_segregation_pass.len() != 2 {
            return Err("the listing truth changed; review the harness truth".into());
        }
        Ok(Self {
            population_not_approved,
            population_after_payment,
            population_undetermined,
            population_all,
            listing_missing_approver,
            listing_segregation,
            listing_segregation_pass,
            listing_all,
            expected,
            data_quality: vec![
                (
                    "duplicate_rows",
                    "The export repeats 6 invoice rows exactly (INV-01000 to INV-01005).",
                    vec!["duplicate"],
                ),
                (
                    "out_of_period",
                    "50 invoices are dated in 2025, outside the 2026 period.",
                    vec!["2025", "out of period", "outside the period", "outside the 2026"],
                ),
                (
                    "control_count",
                    "The cover-sheet count (1,251) does not agree with the 1,250 distinct invoices.",
                    vec!["1,251", "1251", "cover sheet", "cover-sheet", "control count"],
                ),
                (
                    "currency",
                    "Two listing invoices are in EUR; the 1,000.00 USD threshold needs an exchange rate.",
                    vec!["eur", "exchange rate", "currency"],
                ),
            ],
        })
    }

    /// Every truly failing subject, over all four findings.
    pub fn all_exceptions(&self) -> BTreeSet<String> {
        self.population_not_approved
            .iter()
            .chain(&self.population_after_payment)
            .chain(&self.listing_missing_approver)
            .chain(&self.listing_segregation)
            .cloned()
            .collect()
    }

    pub fn is_population(&self, subject: &str) -> bool {
        self.population_all.contains(subject)
    }
    pub fn is_listing(&self, subject: &str) -> bool {
        self.listing_all.contains(subject)
    }
}
