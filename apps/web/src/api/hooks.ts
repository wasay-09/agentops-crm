import type {
  AgentConfig,
  Approval,
  ContactDetail,
  ContactSummary,
  Deal,
  DealStage,
  DeploymentWeight,
  ModelInfo,
  Note,
  Prompt,
  RoutingPolicy,
  RunDetail,
  RunStatus,
  RunSummary,
  UsageSummary,
  User,
  WorkflowRun,
} from '@agentops/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type ContactRow = ContactSummary & { openDeals: number; pipelineUsd: number };
export type DealRow = Deal & { contactName: string };
export interface DecideResult {
  approval: Approval;
  run: RunSummary | null;
  workflowRun: WorkflowRun | null;
}

export const keys = {
  me: ['me'] as const,
  contacts: (q: string) => ['contacts', q] as const,
  contact: (id: number) => ['contact', id] as const,
  deals: (stage?: string) => ['deals', stage ?? 'all'] as const,
  approvals: (status: string) => ['approvals', status] as const,
  runs: (agent?: string, status?: string) => ['runs', agent ?? '', status ?? ''] as const,
  run: (id: string) => ['run', id] as const,
  workflowRun: (id: string) => ['workflow-run', id] as const,
  usage: (days: number) => ['usage', days] as const,
  prompts: ['prompts'] as const,
  prompt: (name: string) => ['prompt', name] as const,
  agents: ['agents'] as const,
  models: ['models'] as const,
  routing: ['routing'] as const,
};

// ---------- CRM ----------

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api<{ user: User } | User>('/me').then((r) => ('user' in r ? r.user : r)),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useContacts(q: string) {
  return useQuery({
    queryKey: keys.contacts(q),
    queryFn: () => api<{ contacts: ContactRow[] }>('/contacts', { query: { q } }).then((r) => r.contacts),
    placeholderData: (prev) => prev,
  });
}

export function useContact(id: number) {
  return useQuery({
    queryKey: keys.contact(id),
    queryFn: () => api<{ contact: ContactDetail }>(`/contacts/${id}`).then((r) => r.contact),
    enabled: Number.isFinite(id),
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; company: string; title?: string; phone?: string }) =>
      api<{ contact: ContactDetail }>('/contacts', { method: 'POST', body }).then((r) => r.contact),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useDeals(stage?: DealStage) {
  return useQuery({
    queryKey: keys.deals(stage),
    queryFn: () => api<{ deals: DealRow[] }>('/deals', { query: { stage } }).then((r) => r.deals),
  });
}

export function useUpdateDealStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, stage }: { dealId: number; stage: DealStage }) =>
      api<{ deal: Deal }>(`/deals/${dealId}`, { method: 'PATCH', body: { stage } }).then((r) => r.deal),
    onSuccess: (deal) => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: keys.contact(deal.contactId) });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
}

export function useAddNote(contactId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<{ note: Note }>(`/contacts/${contactId}/notes`, { method: 'POST', body: { body } }).then(
        (r) => r.note,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.contact(contactId) }),
  });
}

// ---------- AI ----------

export function useAskAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { question: string; contactId?: number }) =>
      api<RunDetail>('/ai/ask', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export function useStartFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: number) =>
      api<WorkflowRun>('/ai/follow-up', { method: 'POST', body: { contactId } }),
    onSuccess: (wf) => {
      qc.setQueryData(keys.workflowRun(wf.id), wf);
      qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
}

const ACTIVE_WORKFLOW = new Set(['running', 'awaiting_approval']);

export function useWorkflowRun(id: string | null) {
  return useQuery({
    queryKey: keys.workflowRun(id ?? ''),
    queryFn: () => api<WorkflowRun>(`/ai/workflow-runs/${id}`),
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data && ACTIVE_WORKFLOW.has(query.state.data.status) ? 3000 : false,
  });
}

export function useRuns(agent?: string, status?: RunStatus) {
  return useQuery({
    queryKey: keys.runs(agent, status),
    queryFn: () =>
      api<{ runs: RunSummary[] }>('/ai/runs', { query: { agent, status, limit: 100 } }).then((r) => r.runs),
    refetchInterval: 15_000,
  });
}

export function useRun(id: string) {
  return useQuery({
    queryKey: keys.run(id),
    queryFn: () => api<RunDetail>(`/ai/runs/${id}`),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2000 : false),
  });
}

export function useApprovals(status: 'pending' | 'approved' | 'rejected' = 'pending', poll = false) {
  return useQuery({
    queryKey: keys.approvals(status),
    queryFn: () =>
      api<{ approvals: Approval[] }>('/ai/approvals', { query: { status } }).then((r) => r.approvals),
    refetchInterval: poll ? 10_000 : false,
  });
}

export function useDecideApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      api<DecideResult>(`/ai/approvals/${id}`, {
        method: 'POST',
        body: { decision, note: note || undefined },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['run'] });
      qc.invalidateQueries({ queryKey: ['contact'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['usage'] });
      if (res.workflowRun) qc.setQueryData(keys.workflowRun(res.workflowRun.id), res.workflowRun);
    },
  });
}

export function useUsage(days: number) {
  return useQuery({
    queryKey: keys.usage(days),
    queryFn: () => api<UsageSummary>('/ai/usage', { query: { days } }),
    refetchInterval: 30_000,
  });
}

// ---------- admin ----------

export function usePrompts() {
  return useQuery({
    queryKey: keys.prompts,
    queryFn: () => api<{ prompts: Prompt[] }>('/ai/admin/prompts').then((r) => r.prompts),
  });
}

export function usePrompt(name: string) {
  return useQuery({
    queryKey: keys.prompt(name),
    queryFn: () =>
      api<{ prompt: Prompt }>(`/ai/admin/prompts/${encodeURIComponent(name)}`).then((r) => r.prompt),
  });
}

function usePromptMutation<V>(name: string, fn: (vars: V) => Promise<{ prompt: Prompt }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => fn(vars).then((r) => r.prompt),
    onSuccess: (prompt) => {
      qc.setQueryData(keys.prompt(name), prompt);
      qc.invalidateQueries({ queryKey: keys.prompts });
    },
  });
}

export function useCreatePromptVersion(name: string) {
  return usePromptMutation(name, (body: { template: string; notes?: string }) =>
    api(`/ai/admin/prompts/${encodeURIComponent(name)}/versions`, { method: 'POST', body }),
  );
}

export function useUpdateDeployment(name: string) {
  return usePromptMutation(name, (weights: DeploymentWeight[]) =>
    api(`/ai/admin/prompts/${encodeURIComponent(name)}/deployment`, { method: 'PUT', body: { weights } }),
  );
}

export function useAgents() {
  return useQuery({
    queryKey: keys.agents,
    queryFn: () => api<{ agents: AgentConfig[] }>('/ai/admin/agents').then((r) => r.agents),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, patch }: { slug: string; patch: Partial<Omit<AgentConfig, 'slug'>> }) =>
      api<unknown>(`/ai/admin/agents/${encodeURIComponent(slug)}`, { method: 'PUT', body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.agents }),
  });
}

export function useModels() {
  return useQuery({
    queryKey: keys.models,
    queryFn: () => api<{ models: ModelInfo[]; mockFallback?: boolean }>('/ai/admin/models'),
  });
}

export function useRouting() {
  return useQuery({
    queryKey: keys.routing,
    queryFn: () => api<{ policies: RoutingPolicy[] }>('/ai/admin/routing').then((r) => r.policies),
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { monthlyBudgetUsd: number; softLimitPct?: number }) =>
      api<unknown>('/ai/admin/budget', { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usage'] }),
  });
}
