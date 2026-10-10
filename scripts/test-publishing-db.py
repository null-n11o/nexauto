#!/usr/bin/env python3
"""Exercise publishing migrations in an isolated PostgreSQL cluster."""
import concurrent.futures
import getpass
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
COMPANY = '10000000-0000-0000-0000-000000000001'
ACTOR = '20000000-0000-0000-0000-000000000001'
POST = '40000000-0000-0000-0000-000000000001'


def run(command, **kwargs):
    result = subprocess.run(command,capture_output=True,text=True,**kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout


with tempfile.TemporaryDirectory(prefix='nexauto-pg-') as temporary:
    folder = Path(temporary)
    cluster = folder/'db'
    run([str(BIN/'initdb'),'-D',str(cluster),'-A','trust','--no-locale'])
    run([str(BIN/'pg_ctl'),'-D',str(cluster),'-l',str(folder/'server.log'),'-o',f"-k {temporary} -p 55491 -h ''",'start','-w'])
    env = {**os.environ,'PGHOST':temporary,'PGPORT':'55491','PGUSER':getpass.getuser(),'PGDATABASE':'postgres'}

    def sql(statement):
        return run([str(BIN/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1'],input=statement,env=env).strip()

    def service(statement):
        return sql("SET ROLE service_role; SET request.jwt.claims = '{\"role\":\"service_role\"}';"+statement)

    def rejected(statement, reason):
        try:
            service(statement)
        except RuntimeError as error:
            assert reason in str(error), str(error)
        else:
            raise AssertionError('Expected rejection: '+reason)

    try:
        sql("""
        CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
        CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT (nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''sub'')::uuid';
        CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        GRANT USAGE ON SCHEMA public,auth,storage,extensions TO authenticated,service_role,anon;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated,service_role;
        """)
        for migration in sorted((ROOT/'supabase/migrations').glob('*.sql')):
            sql(migration.read_text())
        sql(f"""
        INSERT INTO auth.users VALUES ('{ACTOR}');
        INSERT INTO companies(id,name) VALUES ('{COMPANY}','Test'),('10000000-0000-0000-0000-000000000002','Other');
        INSERT INTO users(id,company_id,email,role) VALUES ('{ACTOR}','{COMPANY}','fixture@example.test','admin');
        INSERT INTO accounts(id,company_id,platform,account_name,platform_user_id) VALUES ('30000000-0000-0000-0000-000000000001','{COMPANY}','threads','Dober','123');
        INSERT INTO posts(id,account_id,content,scheduled_date,status,source) VALUES ('{POST}','30000000-0000-0000-0000-000000000001','Reviewed text',current_date,'ready','manual');
        """)
        preview = f"publishing_preview('{POST}','{COMPANY}')"
        approval = f"approve_publication('{POST}','{COMPANY}','{ACTOR}',({preview})->>'digest','CEO fixture approval','mcp')"
        assert service('SELECT count(*) FROM publish_jobs;')=='0'
        assert service(f"SELECT ({preview})->>'digest'=encode(extensions.digest((({preview})->'snapshot')::text,'sha256'),'hex');")=='t'
        service(f"UPDATE posts SET image_url='https://example.test/mutable.jpg' WHERE id='{POST}';")
        rejected(f'SELECT {preview};','external_media_requires_upload')
        service(f"UPDATE posts SET image_url=NULL WHERE id='{POST}';")
        rejected(f"SELECT approve_publication('{POST}','{COMPANY}','{ACTOR}','bad','ref','mcp');",'preview_changed')
        rejected(f"SELECT publishing_preview('{POST}','10000000-0000-0000-0000-000000000002');",'not_found')
        job = service(f'SELECT id FROM {approval};')
        assert service(f'SELECT id FROM {approval};')==job
        service(f"UPDATE posts SET content='Edited' WHERE id='{POST}';")
        assert service(f"SELECT state FROM publish_jobs WHERE id='{job}';")=='failed'
        assert service(f"SELECT revision FROM posts WHERE id='{POST}';")=='4'
        job = service(f'SELECT id FROM {approval};')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            claims = list(pool.map(lambda _:service(f"SELECT id FROM claim_publication('{job}','{COMPANY}');"),range(2)))
        assert sum(bool(value) for value in claims)==1, claims
        fence = service(f"SELECT fence FROM publish_jobs WHERE id='{job}';")
        service(f"SELECT id FROM advance_publication('{job}',{fence},'creating');")
        rejected(f"UPDATE posts SET content='During dispatch' WHERE id='{POST}';",'post_locked')
        sql(f"UPDATE publish_jobs SET lease_until=now()-interval '1 second' WHERE id='{job}';")
        assert service(f"SELECT state FROM claim_publication('{job}','{COMPANY}');")=='unknown'
        assert service(f'SELECT id FROM {approval};')==job
        assert not service(f"SELECT id FROM claim_publication('{job}','{COMPANY}');")
        rejected(f"SELECT recover_publication('{job}','{COMPANY}','{ACTOR}','not_published','guess');",'recovery_evidence_required')
        rejected(f"SELECT recover_publication('{job}','{COMPANY}','{ACTOR}','not_published',NULL);",'recovery_evidence_required')
        rejected(f"SELECT recover_publication('{job}','{COMPANY}','{ACTOR}','not_published','                         ');",'recovery_evidence_required')
        service(f"SELECT id FROM recover_publication('{job}','{COMPANY}','{ACTOR}','not_published','Operator checked platform and confirmed no published post.');")
        service(f"SELECT id FROM claim_publication('{job}','{COMPANY}');")
        fence = service(f"SELECT fence FROM publish_jobs WHERE id='{job}';")
        service(f"SELECT id FROM advance_publication('{job}',{fence},'creating'); SELECT id FROM advance_publication('{job}',{fence},'processing','container');")
        service(f"SELECT id FROM claim_publication('{job}','{COMPANY}');")
        fence = service(f"SELECT fence FROM publish_jobs WHERE id='{job}';")
        service(f"SELECT id FROM advance_publication('{job}',{fence},'publishing'); SELECT id FROM advance_publication('{job}',{fence},'published',NULL,'media');")
        assert service(f"SELECT status||':'||platform_post_id FROM posts WHERE id='{POST}';")=='published:media'
        assert not service(f"SELECT id FROM claim_publication('{job}','{COMPANY}');")
        try:
            sql(f"SET ROLE authenticated; SET request.jwt.claims='{{\"role\":\"authenticated\",\"sub\":\"{ACTOR}\"}}'; SELECT approve_publication('{POST}','{COMPANY}','{ACTOR}','bad','ref','ui');")
        except RuntimeError as error:
            assert 'permission denied' in str(error)
        else:
            raise AssertionError('Unprivileged approval accepted')
        sql(f"""
        INSERT INTO media_assets(id,company_id,object_path,kind,mime_type,size_bytes,sha256,status) VALUES
        ('50000000-0000-0000-0000-000000000001','{COMPANY}','fixture/image.jpg','image','image/jpeg',100,repeat('a',64),'verified'),
        ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','other/image.jpg','image','image/jpeg',100,repeat('b',64),'verified');
        INSERT INTO posts(id,account_id,content,scheduled_date,status,source,asset_id) VALUES
        ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','Reviewed image',current_date,'draft','manual','50000000-0000-0000-0000-000000000001');
        """)
        service(f"INSERT INTO posts(id,account_id,content,scheduled_date,status,source,platform_post_id) VALUES ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','Imported history',current_date,'published','manual','historical-media');")
        rejected("INSERT INTO posts(account_id,content,scheduled_date,status,source) VALUES ('30000000-0000-0000-0000-000000000001','Forged',current_date,'published','manual');",'approval_required')
        image_post = '40000000-0000-0000-0000-000000000002'
        assert service(f"SELECT publishing_preview('{image_post}','{COMPANY}')->'snapshot'->'asset'->>'kind';")=='image'
        rejected(f"UPDATE posts SET asset_id='50000000-0000-0000-0000-000000000002' WHERE id='{image_post}';",'asset_scope')
        claims = f"SET ROLE authenticated; SET request.jwt.claims='{{\"role\":\"authenticated\",\"sub\":\"{ACTOR}\"}}';"
        assert sql(claims+'SELECT count(*) FROM media_assets;')=='1'
        for statement, reason in [
            (f"UPDATE posts SET platform_post_id='forged',status='published' WHERE id='{image_post}';",'approval_required'),
            ("UPDATE media_assets SET status='verified';",'permission denied'),
            ("UPDATE publish_jobs SET state='queued';",'permission denied'),
        ]:
            try:
                sql(claims+statement)
            except RuntimeError as error:
                assert reason in str(error), str(error)
            else:
                raise AssertionError('Protected write accepted')
        print('Publishing DB checks passed: approval, scope, revision, concurrent claims, uncertain writes, recovery, publication, verified images, protected fields, tenant reads, permissions.')
    finally:
        run([str(BIN/'pg_ctl'),'-D',str(cluster),'stop','-m','fast','-w'])
