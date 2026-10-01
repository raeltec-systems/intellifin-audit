WITH objects AS (
 SELECT 'table|' || c.relname || '|' || c.relkind::text || '|' || c.relpersistence::text || '|' || c.relrowsecurity || '|' || c.relforcerowsecurity AS signature
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind <> 'i'
 UNION ALL
 SELECT 'column|' || c.relname || '|' || a.attnum || '|' || a.attname || '|' || pg_catalog.format_type(a.atttypid,a.atttypmod) || '|' || a.attnotnull || '|' || COALESCE(pg_catalog.left(pg_catalog.pg_get_expr(d.adbin,d.adrelid),2048),'') || '|' || a.attidentity::text || '|' || a.attgenerated::text
 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint|' || c.relname || '|' || k.conname || '|' || k.convalidated || '|' || pg_catalog.left(pg_catalog.pg_get_constraintdef(k.oid),2048)
 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'index|' || c.relname || '|' || i.indisvalid || '|' || i.indisready || '|' || pg_catalog.left(pg_catalog.pg_get_indexdef(i.indexrelid),2048)
 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'trigger|' || c.relname || '|' || COALESCE(k.conname::text,'') || '|' || t.tgenabled::text || '|' || t.tgtype || '|' || t.tgdeferrable || '|' || t.tginitdeferred || '|' || t.tgfoid::pg_catalog.regproc::text || '|' || COALESCE(referenced.relname::text,'') || '|' || pg_catalog.encode(t.tgargs,'hex') || '|' || COALESCE(pg_catalog.left(pg_catalog.pg_get_expr(t.tgqual,t.tgrelid),2048),'')
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_constraint k ON k.oid=t.tgconstraint LEFT JOIN pg_catalog.pg_class referenced ON referenced.oid=t.tgconstrrelid WHERE n.nspname='public' AND t.tgisinternal
 UNION ALL
 SELECT 'user_trigger|' || c.relname || '|' || t.tgname || '|' || t.tgenabled::text || '|' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(t.oid),'UTF8')),'hex')
 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL
 SELECT 'policy|' || c.relname || '|' || p.polname || '|' || p.polcmd::text || '|' || p.polpermissive || '|' || p.polroles::text || '|' || COALESCE(pg_catalog.left(pg_catalog.pg_get_expr(p.polqual,p.polrelid),8192),'') || '|' || COALESCE(pg_catalog.left(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),8192),'')
 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'function|' || p.proname || '|' || pg_catalog.pg_get_function_identity_arguments(p.oid) || '|' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8')),'hex')
 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'

) SELECT pg_catalog.replace(signature, pg_catalog.chr(10), ' ') AS signature FROM objects ORDER BY signature COLLATE "C" LIMIT 4097;
