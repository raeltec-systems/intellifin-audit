//! The real HTTP wire proves bounded metadata coverage and exact-session fences.
use super::*;

async fn search(browser: &Browser, query: &str, after: Option<&str>, status: StatusCode) -> Value {
    let mut request = browser
        .request(Method::GET, "evidence")
        .query(&[("q", query)]);
    if let Some(after) = after {
        request = request.query(&[("after", after)]);
    }
    document(request.send().await.unwrap(), status).await
}

pub(super) async fn bounded_metadata_search(
    browser: &Browser,
    peer: &Browser,
    admin: &mut PgConnection,
    source_id: &str,
) {
    for query in ["ORIGINAL", "User export", "Selected original"] {
        let page = search(browser, query, None, StatusCode::OK).await;
        assert_eq!(page["query"], query);
        assert_eq!(page["items"].as_array().unwrap().len(), 1);
        assert_eq!(page["items"][0]["reservation"]["id"], source_id);
        assert_eq!(
            page["coverage"],
            json!({"examined_count":1,"candidate_limit":256,"complete":true})
        );
        assert!(page["next_cursor"].is_null());
    }
    let contents = search(browser, "Alder", None, StatusCode::OK).await;
    assert_eq!(
        contents["items"],
        json!([]),
        "original contents never become searched metadata"
    );
    assert_eq!(contents["coverage"]["examined_count"], 1);
    let trimmed = search(browser, "\u{2003}ORIGINAL\u{a0}", None, StatusCode::OK).await;
    assert_eq!(trimmed["query"], "ORIGINAL");
    for query in ["\noriginal".into(), "bad\0query".into(), "🙂".repeat(51)] {
        assert_eq!(
            search(browser, &query, None, StatusCode::BAD_REQUEST).await["error"],
            "evidence_invalid"
        );
    }
    for query in [
        "🙂".repeat(50),
        "\u{feff}source".into(),
        "source\u{200d}name".into(),
    ] {
        assert_eq!(
            search(browser, &query, None, StatusCode::OK).await["query"],
            query
        );
    }
    assert_eq!(
        search(browser, "source", Some("../bad"), StatusCode::BAD_REQUEST).await["error"],
        "evidence_invalid"
    );
    let wrong_session = browser
        .request(Method::GET, "evidence")
        .query(&[("q", "original")])
        .header("X-Expected-Session", "replaced-session")
        .send()
        .await
        .unwrap();
    document(wrong_session, StatusCode::PRECONDITION_FAILED).await;

    unicode_metadata_search_uses_context_independent_case_mapping(browser, peer).await;

    // Synthetic registered metadata fills candidate density. Exact source bytes
    // and custody are independently exercised by the parent's acquired original.
    sqlx::query("INSERT INTO evidence_reservations(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at) SELECT 'search-'||lpad(n::text,4,'0'),organisation_id,client_id,engagement_id,actor_id,'search-key-'||n,(request::jsonb || jsonb_build_object('key','search-key-'||n,'filename','Résumé 界🙂 '||n||'.txt','coverage',CASE WHEN n=256 THEN 'Rare %_ needle' ELSE NULL END))::text,digest,size,namespace,reserved_at FROM evidence_reservations CROSS JOIN generate_series(0,256) n WHERE id=$1")
        .bind(source_id).execute(&mut *admin).await.unwrap();
    sqlx::query("INSERT INTO evidence_originals(id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,version) SELECT id,organisation_id,client_id,engagement_id,actor_id,key,request,digest,size,namespace,reserved_at,'search-version' FROM evidence_reservations WHERE id LIKE 'search-%'")
        .execute(&mut *admin).await.unwrap();
    // Real acquired originals have random IDs and can fall anywhere in this
    // prefix. They consume examined-candidate budget even when they do not match.
    let candidates: Vec<String> = sqlx::query_scalar("SELECT id FROM evidence_originals WHERE organisation_id='org-a' AND client_id='client-a' AND engagement_id='engagement-a' AND id COLLATE \"C\">'search-' ORDER BY id COLLATE \"C\"")
        .fetch_all(&mut *admin).await.unwrap();
    let first = search(peer, "%_ NEEDLE", Some("search-"), StatusCode::OK).await;
    assert_eq!(first["items"], json!([]));
    assert_eq!(
        first["coverage"],
        json!({"examined_count":256,"candidate_limit":256,"complete":false})
    );
    assert_eq!(first["next_cursor"], candidates[255]);
    let last = search(
        peer,
        "%_ NEEDLE",
        first["next_cursor"].as_str(),
        StatusCode::OK,
    )
    .await;
    assert_eq!(last["items"].as_array().unwrap().len(), 1);
    assert_eq!(last["items"][0]["reservation"]["id"], "search-0256");
    assert_eq!(
        last["coverage"],
        json!({"examined_count":candidates.len() - 256,"candidate_limit":256,"complete":true})
    );
    assert!(last["next_cursor"].is_null());
    let mut after = Some("search-".to_owned());
    let mut ids = Vec::new();
    let mut pages = 0;
    let mut examined = 0;
    loop {
        let page = search(peer, "RÉSUMÉ 界🙂", after.as_deref(), StatusCode::OK).await;
        let items = page["items"].as_array().unwrap();
        assert!(items.len() <= 50);
        pages += 1;
        let expected_cursor = (pages < 6).then(|| format!("search-{:04}", pages * 50 - 1));
        let expected_end = expected_cursor.as_ref().map_or(candidates.len(), |cursor| {
            candidates.iter().position(|id| id == cursor).unwrap() + 1
        });
        assert_eq!(page["coverage"]["examined_count"], expected_end - examined);
        assert_eq!(page["next_cursor"], json!(expected_cursor));
        examined = expected_end;
        for item in items {
            assert_eq!(item["reservation"]["actor_id"], "identity-a");
            assert_eq!(
                item["reservation"]["scope"],
                json!({"organisation_id":"org-a","client_id":"client-a","engagement_id":"engagement-a"})
            );
            assert_eq!(item["version"], "search-version");
            ids.push(item["reservation"]["id"].as_str().unwrap().to_owned());
        }
        after = page["next_cursor"].as_str().map(str::to_owned);
        assert_eq!(page["coverage"]["complete"], after.is_none());
        if after.is_none() {
            break;
        }
        assert!(pages < 7, "search cursor must make progress");
    }
    assert_eq!(pages, 6);
    assert_eq!(
        ids,
        (0..257)
            .map(|n| format!("search-{n:04}"))
            .collect::<Vec<_>>()
    );
}

async fn unicode_metadata_search_uses_context_independent_case_mapping(
    browser: &Browser,
    peer: &Browser,
) {
    let bytes = b"Greek metadata fixture; original contents are not search metadata.";
    let mut request = claim("unicode-search-prefix", "ΟΣΑ Café %_.txt", bytes);
    request["source"] = json!({
        "system":"ΔΟΣΑ", "account":"ΠΟΣΑ", "source_version":"ΝΟΣΑ",
        "selection":"ΡΟΣΑ", "coverage":"ΤΟΣΑ"
    });
    let reserved = document(browser.reserve(&request).await, StatusCode::OK).await;
    let id = reserved["id"].as_str().unwrap();
    let evidence = document(browser.upload(id, bytes).await, StatusCode::OK).await;
    assert_eq!(evidence["reservation"]["request"], request);
    for query in [
        "ΟΣ", "οσ", "ΟΣΑ", "ΔΟΣ", "ΠΟΣ", "ΝΟΣ", "ΡΟΣ", "ΤΟΣ", "CAFÉ", "%_",
    ] {
        let page = search(peer, query, None, StatusCode::OK).await;
        assert_eq!(page["query"], query);
        assert_eq!(page["items"], json!([evidence]));
        assert_eq!(
            page["coverage"],
            json!({"examined_count":2,"candidate_limit":256,"complete":true})
        );
        assert!(page["next_cursor"].is_null());
    }
    for query in ["ΟΣΒ", "Cafe\u{301}", ".*", "%X"] {
        let page = search(peer, query, None, StatusCode::OK).await;
        assert_eq!(page["query"], query);
        assert_eq!(page["items"], json!([]));
        assert_eq!(page["coverage"]["examined_count"], 2);
        assert_eq!(page["coverage"]["complete"], true);
        assert!(page["next_cursor"].is_null());
    }
}

pub(super) async fn revocation_while_search_waits(
    browser: &Browser,
    identities: &IdentityRepository,
    admin: &mut PgConnection,
) {
    let token = identities
        .establish_session(ISSUER, "auditor-peer", "Peer", None)
        .await
        .unwrap();
    let captured = Browser {
        csrf: identities.session(&token).await.unwrap().csrf_token,
        token: token.clone(),
        ..browser.clone()
    };
    let mut barrier = admin.begin().await.unwrap();
    sqlx::query("SELECT id FROM engagements WHERE organisation_id='org-a' AND client_id='client-a' AND id='engagement-a' FOR UPDATE").execute(&mut *barrier).await.unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *barrier)
        .await
        .unwrap();
    let waiting = tokio::spawn(async move {
        captured
            .request(Method::GET, "evidence")
            .query(&[("q", "Résumé")])
            .send()
            .await
            .unwrap()
    });
    timeout(Duration::from_secs(3), async {
        loop {
            let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity a WHERE a.datname=current_database() AND $1=ANY(pg_blocking_pids(a.pid)))").bind(pid).fetch_one(&mut *barrier).await.unwrap();
            if blocked { break; }
            tokio::task::yield_now().await;
        }
    }).await.expect("search must reach the owned authority lock");
    identities.logout(&token).await.unwrap();
    barrier.commit().await.unwrap();
    let response = timeout(Duration::from_secs(3), waiting)
        .await
        .unwrap()
        .unwrap();
    document(response, StatusCode::FORBIDDEN).await;
}
