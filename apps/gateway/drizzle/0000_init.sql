CREATE TABLE "agents" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"task_type" text NOT NULL,
	"prompt_name" text NOT NULL,
	"tools" text[] NOT NULL,
	"max_steps" integer DEFAULT 6 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"run_id" uuid,
	"tool_call_id" uuid,
	"workflow_run_id" uuid,
	"workflow_step_id" text,
	"requested_by" text,
	"decided_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"amount_usd" numeric(14, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"run_id" uuid,
	"agent_slug" text,
	"task_type" text NOT NULL,
	"step" integer NOT NULL,
	"attempt" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"routing_reason" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(14, 6) DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"prompt_version_id" uuid,
	"trace_id" text,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model_name" text NOT NULL,
	"tier" text NOT NULL,
	"input_usd_per_mtok" numeric(14, 6) NOT NULL,
	"output_usd_per_mtok" numeric(14, 6) NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_deployments" (
	"prompt_id" uuid PRIMARY KEY NOT NULL,
	"weights" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "routing_policies" (
	"task_type" text PRIMARY KEY NOT NULL,
	"chain" text[] NOT NULL,
	"budget_model" text,
	"max_output_tokens" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"message" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"agent_slug" text NOT NULL,
	"task_type" text NOT NULL,
	"status" text NOT NULL,
	"input" text NOT NULL,
	"context" jsonb,
	"actor" text,
	"idempotency_key" text,
	"system_prompt" text NOT NULL,
	"prompt_version_id" uuid,
	"prompt_version" integer,
	"step" integer DEFAULT 0 NOT NULL,
	"output" text,
	"error" text,
	"trace_id" text,
	"workflow_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"monthly_budget_usd" numeric(14, 6) NOT NULL,
	"soft_limit_pct" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"provider_call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"mode" text NOT NULL,
	"args" jsonb,
	"result" jsonb,
	"status" text NOT NULL,
	"latency_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"workflow" text NOT NULL,
	"status" text NOT NULL,
	"input" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"error" text,
	"actor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tool_call_id_tool_calls_id_fk" FOREIGN KEY ("tool_call_id") REFERENCES "public"."tool_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_deployments" ADD CONSTRAINT "prompt_deployments_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_messages" ADD CONSTRAINT "run_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_team_idx" ON "api_keys" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "approvals_team_status_idx" ON "approvals" USING btree ("team_id","status");--> statement-breakpoint
CREATE INDEX "budget_reservations_team_idx" ON "budget_reservations" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_calls_run_step_attempt_uq" ON "llm_calls" USING btree ("run_id","step","attempt");--> statement-breakpoint
CREATE INDEX "llm_calls_team_started_idx" ON "llm_calls" USING btree ("team_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_prompt_version_uq" ON "prompt_versions" USING btree ("prompt_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "run_messages_run_seq_uq" ON "run_messages" USING btree ("run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_team_idempotency_uq" ON "runs" USING btree ("team_id","idempotency_key") WHERE "runs"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "runs_team_created_idx" ON "runs" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_team_idx" ON "workflow_runs" USING btree ("team_id","created_at");