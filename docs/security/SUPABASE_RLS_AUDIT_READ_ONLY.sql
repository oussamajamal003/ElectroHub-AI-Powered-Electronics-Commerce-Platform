BEGIN READ ONLY;
SET LOCAL statement_timeout = '12s';
SELECT current_database() AS database_name, current_user AS audit_role, current_setting('server_version') AS server_version,
 current_setting('pgrst.db_schemas',true) AS session_exposed_schemas,
 (SELECT jsonb_agg(jsonb_build_object('database',COALESCE(d.datname,'ALL'),'role',COALESCE(r.rolname,'ALL'),'setting',setting))
 FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid=s.setdatabase LEFT JOIN pg_roles r ON r.oid=s.setrole
 CROSS JOIN LATERAL unnest(s.setconfig) setting WHERE setting LIKE 'pgrst.db_schemas=%' OR setting LIKE 'pgrst.db_extra_search_path=%') AS configured_api_schemas,
 (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'options',c.reloptions,
 'columns',(SELECT jsonb_agg(a.attname ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN ac.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(ac.grantee) END,'grantor',pg_get_userbyid(ac.grantor),'privilege',ac.privilege_type,'grantable',ac.is_grantable)) FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) ac),
 'client_privileges',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'schema_usage',has_schema_privilege(r.oid,n.oid,'USAGE'),'select',has_table_privilege(r.oid,c.oid,'SELECT'),'insert',has_table_privilege(r.oid,c.oid,'INSERT'),'update',has_table_privilege(r.oid,c.oid,'UPDATE'),'delete',has_table_privilege(r.oid,c.oid,'DELETE'),'truncate',has_table_privilege(r.oid,c.oid,'TRUNCATE'),'any_column_select',has_any_column_privilege(r.oid,c.oid,'SELECT'),'any_column_insert',has_any_column_privilege(r.oid,c.oid,'INSERT'),'any_column_update',has_any_column_privilege(r.oid,c.oid,'UPDATE'))) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','authenticator','postgres')),
 'policies',(SELECT jsonb_agg(jsonb_build_object('name',p.policyname,'roles',p.roles,'command',p.cmd,'permissive',p.permissive,'using',p.qual,'check',p.with_check)) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname)))
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage') AND c.relkind IN ('r','p','v','m')) AS relations,
 (SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,'login',r.rolcanlogin,'inherit',r.rolinherit)) FROM pg_roles r) AS roles,
 (SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),'admin_option',m.admin_option)) FROM pg_auth_members m) AS role_memberships,
 (SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(a.defaclrole),'schema',COALESCE(n.nspname,'ALL'),'object_type',a.defaclobjtype,'grantee',CASE WHEN ac.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(ac.grantee) END,'privilege',ac.privilege_type)) FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace CROSS JOIN LATERAL aclexplode(a.defaclacl) ac) AS default_privileges;
COMMIT;

BEGIN READ ONLY; SET LOCAL statement_timeout='12s';
SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer, p.provolatile AS volatility,
 (SELECT jsonb_agg(v) FROM unnest(p.proconfig) v WHERE v LIKE 'search_path=%') AS search_path,
 pg_get_functiondef(p.oid) AS definition,
 (SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'execute',has_function_privilege(r.oid,p.oid,'EXECUTE'),'schema_usage',has_schema_privilege(r.oid,n.oid,'USAGE'))) FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role','authenticator')) AS client_execute,
 (SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN ac.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(ac.grantee) END,'privilege',ac.privilege_type)) FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) ac) AS acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','graphql_public','storage') AND p.prokind='f' ORDER BY n.nspname,p.proname;
COMMIT;

BEGIN READ ONLY; SET LOCAL statement_timeout='12s';
SELECT
 (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN ac.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(ac.grantee) END,'privilege',ac.privilege_type)) FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) ac))) FROM pg_namespace n WHERE n.nspname IN ('public','storage','graphql_public')) AS schemas,
 (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'function',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'client_callable',EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated') AND has_schema_privilege(r.oid,n.oid,'USAGE') AND has_function_privilege(r.oid,p.oid,'EXECUTE')),
 'public_dependencies',(SELECT jsonb_agg(jsonb_build_object('schema',rn.nspname,'name',c.relname)) FROM pg_depend d JOIN pg_class c ON c.oid=d.refobjid JOIN pg_namespace rn ON rn.oid=c.relnamespace WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.refclassid='pg_class'::regclass AND rn.nspname='public'))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND p.prokind='f' AND n.nspname NOT IN ('pg_catalog','information_schema')) AS security_definers,
 (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'acl',(SELECT jsonb_agg(jsonb_build_object('grantee',CASE WHEN ac.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(ac.grantee) END,'privilege',ac.privilege_type)) FROM aclexplode(COALESCE(c.relacl,acldefault('S',c.relowner))) ac))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S') AS sequences,
 (SELECT jsonb_agg(jsonb_build_object('name',pubname,'all_tables',puballtables)) FROM pg_publication) AS publications,
 (SELECT jsonb_agg(jsonb_build_object('publication',pubname,'schema',schemaname,'table',tablename)) FROM pg_publication_tables WHERE schemaname='public') AS public_publications;
COMMIT;
