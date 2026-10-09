ALTER TABLE accounts DROP CONSTRAINT accounts_platform_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_platform_check CHECK (platform IN ('x','threads','instagram'));
ALTER TABLE accounts ADD COLUMN publishing_policy text NOT NULL DEFAULT 'explicit' CHECK (publishing_policy IN ('legacy','explicit'));
UPDATE accounts SET publishing_policy = 'legacy' WHERE platform = 'x' OR (platform = 'threads' AND account_name NOT ILIKE '%dober%');
ALTER TABLE accounts ADD COLUMN token_expires_at timestamptz;
ALTER TABLE accounts ADD COLUMN token_refreshed_at timestamptz;
ALTER TABLE accounts ADD COLUMN token_checked_at timestamptz;
ALTER TABLE accounts ADD COLUMN connection_status text NOT NULL DEFAULT 'unchecked' CHECK (connection_status IN ('unchecked','connected','invalid'));

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  object_path text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('video','image')),
  mime_type text NOT NULL CHECK (mime_type IN ('video/mp4','image/jpeg')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 300000000),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','verified','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assets: company read" ON media_assets FOR SELECT TO authenticated USING (company_id = get_my_company_id());
REVOKE ALL ON media_assets FROM authenticated,anon;
GRANT SELECT ON media_assets TO authenticated;
GRANT ALL ON media_assets TO service_role;

ALTER TABLE posts ADD COLUMN asset_id uuid REFERENCES media_assets(id);
ALTER TABLE posts ADD COLUMN cover_asset_id uuid REFERENCES media_assets(id);
ALTER TABLE posts ADD COLUMN share_to_feed boolean NOT NULL DEFAULT true;
ALTER TABLE posts ADD COLUMN is_ai_generated boolean NOT NULL DEFAULT false;
ALTER TABLE posts ADD COLUMN revision integer NOT NULL DEFAULT 1;
ALTER TABLE posts ADD COLUMN execution_at timestamptz;

CREATE TABLE publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  revision integer NOT NULL,
  digest text NOT NULL,
  snapshot jsonb NOT NULL,
  approved_by uuid NOT NULL REFERENCES users(id),
  instruction_ref text NOT NULL CHECK (length(instruction_ref) BETWEEN 1 AND 2000),
  source text NOT NULL CHECK (source IN ('ui','mcp')),
  approved_at timestamptz NOT NULL DEFAULT now(),
  run_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','creating','processing','publishing','published','failed','unknown')),
  lease_until timestamptz,
  fence integer NOT NULL DEFAULT 0,
  container_id text,
  platform_post_id text,
  permalink text,
  error_code text,
  recovery_evidence text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_id, revision)
);
ALTER TABLE publish_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs: company read" ON publish_jobs FOR SELECT TO authenticated USING (company_id = get_my_company_id());
REVOKE ALL ON publish_jobs FROM authenticated,anon;
GRANT SELECT ON publish_jobs TO authenticated;
GRANT ALL ON publish_jobs TO service_role;
CREATE INDEX publish_jobs_due ON publish_jobs(run_at) WHERE state IN ('queued','processing','creating','publishing');

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('post-media','post-media',false,300000000,ARRAY['video/mp4','image/jpeg']) ON CONFLICT(id) DO NOTHING;

CREATE FUNCTION publishing_snapshot(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p posts; a accounts; m media_assets; c media_assets;
BEGIN
  SELECT * INTO STRICT p FROM posts WHERE id = p_id;
  SELECT * INTO STRICT a FROM accounts WHERE id = p.account_id;
  IF a.platform NOT IN ('threads','instagram') OR a.platform_user_id IS NULL THEN RAISE EXCEPTION 'invalid_account'; END IF;
  IF p.status = 'published' THEN RAISE EXCEPTION 'already_published'; END IF;
  IF length(p.content) > (CASE WHEN a.platform='instagram' THEN 2200 ELSE 500 END) THEN RAISE EXCEPTION 'caption_too_long'; END IF;
  IF p.asset_id IS NOT NULL THEN
    SELECT * INTO STRICT m FROM media_assets WHERE id = p.asset_id AND company_id = a.company_id AND status = 'verified';
  END IF;
  IF a.platform='instagram' AND (m.id IS NULL OR m.kind <> 'video') THEN RAISE EXCEPTION 'reel_requires_video'; END IF;
  IF p.asset_id IS NULL AND nullif(trim(p.content),'') IS NULL AND p.image_url IS NULL THEN RAISE EXCEPTION 'empty_post'; END IF;
  IF p.image_url IS NOT NULL THEN RAISE EXCEPTION 'external_media_requires_upload'; END IF;
  IF p.cover_asset_id IS NOT NULL THEN
    SELECT * INTO STRICT c FROM media_assets WHERE id = p.cover_asset_id AND company_id = a.company_id AND status = 'verified' AND kind='image';
    IF a.platform<>'instagram' THEN RAISE EXCEPTION 'cover_only_instagram'; END IF;
  END IF;
  RETURN jsonb_build_object('post_id',p.id,'revision',p.revision,'account_id',a.id,'platform',a.platform,
    'platform_user_id',a.platform_user_id,'account_name',a.account_name,'content',p.content,
    'asset',CASE WHEN m.id IS NULL THEN NULL ELSE jsonb_build_object('id',m.id,'path',m.object_path,'sha256',m.sha256,'kind',m.kind) END,
    'cover',CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id',c.id,'path',c.object_path,'sha256',c.sha256,'kind',c.kind) END,
    'image_url',p.image_url,'share_to_feed',p.share_to_feed,'is_ai_generated',p.is_ai_generated,'execution_at',p.execution_at);
END $$;

CREATE FUNCTION guard_publishing_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a accounts;
BEGIN
  SELECT * INTO STRICT a FROM accounts WHERE id=NEW.account_id;
  IF EXISTS (SELECT 1 FROM media_assets WHERE id IN (NEW.asset_id,NEW.cover_asset_id) AND company_id<>a.company_id) THEN RAISE EXCEPTION 'asset_scope'; END IF;
  IF TG_OP='INSERT' THEN
    NEW.revision := 1;
    IF a.publishing_policy='explicit' AND NEW.status='published' AND (coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' OR nullif(trim(NEW.platform_post_id),'') IS NULL) THEN RAISE EXCEPTION 'approval_required'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.account_id,NEW.content,NEW.image_url,NEW.asset_id,NEW.cover_asset_id,NEW.share_to_feed,NEW.is_ai_generated,NEW.execution_at,NEW.scheduled_date)
    IS DISTINCT FROM ROW(OLD.account_id,OLD.content,OLD.image_url,OLD.asset_id,OLD.cover_asset_id,OLD.share_to_feed,OLD.is_ai_generated,OLD.execution_at,OLD.scheduled_date) THEN
    IF EXISTS(SELECT 1 FROM publish_jobs WHERE post_id=OLD.id AND state IN ('creating','processing','publishing','unknown','published')) THEN RAISE EXCEPTION 'post_locked'; END IF;
    UPDATE publish_jobs SET state='failed',error_code='approval_invalidated',updated_at=now() WHERE post_id=OLD.id AND state='queued';
    NEW.revision := OLD.revision + 1;
  ELSE NEW.revision := OLD.revision;
  END IF;
  IF a.publishing_policy='explicit' AND (NEW.status='published' OR NEW.platform_post_id IS DISTINCT FROM OLD.platform_post_id) AND coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' THEN RAISE EXCEPTION 'approval_required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_publishing_post BEFORE INSERT OR UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION guard_publishing_post();

CREATE FUNCTION publishing_preview(p_id uuid,p_company uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE snap jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM posts p JOIN accounts a ON a.id=p.account_id WHERE p.id=p_id AND a.company_id=p_company) THEN RAISE EXCEPTION 'not_found'; END IF;
  snap := publishing_snapshot(p_id);
  RETURN jsonb_build_object('snapshot',snap,'digest',encode(digest(snap::text,'sha256'),'hex'));
END $$;

CREATE FUNCTION approve_publication(p_id uuid,p_company uuid,p_actor uuid,p_digest text,p_instruction text,p_source text) RETURNS publish_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE preview jsonb; job publish_jobs; p posts;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND company_id=p_company AND role='admin') THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT * INTO STRICT p FROM posts WHERE id=p_id FOR UPDATE;
  preview := publishing_preview(p_id,p_company);
  IF preview->>'digest'<>p_digest THEN RAISE EXCEPTION 'preview_changed'; END IF;
  SELECT * INTO job FROM publish_jobs WHERE post_id=p_id AND revision=p.revision;
  IF FOUND THEN RETURN job; END IF;
  INSERT INTO publish_jobs(post_id,company_id,revision,digest,snapshot,approved_by,instruction_ref,source,run_at)
    VALUES(p_id,p_company,p.revision,p_digest,preview->'snapshot',p_actor,p_instruction,p_source,coalesce(p.execution_at,now())) RETURNING * INTO job;
  RETURN job;
END $$;

CREATE FUNCTION claim_publication(p_job uuid,p_company uuid) RETURNS publish_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job publish_jobs; preview jsonb;
BEGIN
  SELECT * INTO STRICT job FROM publish_jobs WHERE id=p_job AND company_id=p_company FOR UPDATE;
  IF job.state IN ('creating','publishing') AND job.lease_until<now() THEN
    UPDATE publish_jobs SET state='unknown',error_code='interrupted_write',lease_until=NULL WHERE id=p_job RETURNING * INTO job;
    RETURN job;
  END IF;
  IF job.state NOT IN ('queued','processing') OR job.run_at>now() OR job.lease_until>now() THEN RETURN NULL; END IF;
  preview := publishing_preview(job.post_id,p_company);
  IF preview->>'digest'<>job.digest THEN
    UPDATE publish_jobs SET state='failed',error_code='approval_invalidated' WHERE id=p_job;
    RETURN NULL;
  END IF;
  UPDATE publish_jobs SET fence=fence+1,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=p_job RETURNING * INTO job;
  RETURN job;
END $$;

CREATE FUNCTION advance_publication(p_job uuid,p_fence integer,p_state text,p_container text DEFAULT NULL,p_media text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS publish_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job publish_jobs;
BEGIN
  SELECT * INTO STRICT job FROM publish_jobs WHERE id=p_job AND fence=p_fence AND lease_until>now() FOR UPDATE;
  IF NOT ((job.state='queued' AND p_state IN ('creating','failed')) OR
    (job.state='creating' AND p_state IN ('processing','failed','unknown')) OR
    (job.state='processing' AND p_state IN ('processing','publishing','failed','unknown')) OR
    (job.state='publishing' AND p_state IN ('published','failed','unknown'))) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  UPDATE publish_jobs SET state=p_state,container_id=coalesce(p_container,container_id),platform_post_id=coalesce(p_media,platform_post_id),error_code=p_error,
    lease_until=CASE WHEN p_state IN ('processing','published','failed','unknown') THEN NULL ELSE lease_until END,updated_at=now() WHERE id=p_job RETURNING * INTO job;
  IF p_state='published' THEN
    IF p_media IS NULL THEN RAISE EXCEPTION 'media_id_required'; END IF;
    UPDATE posts SET status='published',published_at=now(),platform_post_id=p_media,error_message=NULL WHERE id=job.post_id;
  END IF;
  RETURN job;
END $$;

CREATE FUNCTION recover_publication(p_job uuid,p_company uuid,p_actor uuid,p_outcome text,p_evidence text,p_media text DEFAULT NULL) RETURNS publish_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE job publish_jobs;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND company_id=p_company AND role='admin') THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_evidence IS NULL OR length(trim(p_evidence))<20 THEN RAISE EXCEPTION 'recovery_evidence_required'; END IF;
  SELECT * INTO STRICT job FROM publish_jobs WHERE id=p_job AND company_id=p_company AND state IN ('unknown','failed') FOR UPDATE;
  IF p_outcome='published' AND p_media IS NOT NULL THEN
    UPDATE publish_jobs SET state='published',platform_post_id=p_media,recovery_evidence=p_evidence,error_code=NULL WHERE id=p_job RETURNING * INTO job;
    UPDATE posts SET status='published',published_at=now(),platform_post_id=p_media WHERE id=job.post_id;
  ELSIF p_outcome='not_published' THEN
    IF (publishing_preview(job.post_id,p_company)->>'digest')<>job.digest THEN RAISE EXCEPTION 'preview_changed'; END IF;
    UPDATE publish_jobs SET state='queued',container_id=NULL,lease_until=NULL,recovery_evidence=p_evidence,error_code=NULL WHERE id=p_job RETURNING * INTO job;
  ELSE RAISE EXCEPTION 'invalid_recovery'; END IF;
  RETURN job;
END $$;

REVOKE ALL ON FUNCTION publishing_snapshot(uuid),publishing_preview(uuid,uuid),approve_publication(uuid,uuid,uuid,text,text,text),claim_publication(uuid,uuid),advance_publication(uuid,integer,text,text,text,text),recover_publication(uuid,uuid,uuid,text,text,text) FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION publishing_preview(uuid,uuid),approve_publication(uuid,uuid,uuid,text,text,text),claim_publication(uuid,uuid),advance_publication(uuid,integer,text,text,text,text),recover_publication(uuid,uuid,uuid,text,text,text) TO service_role;
