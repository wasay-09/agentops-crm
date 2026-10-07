import { useState } from 'react';
import { useApprovals } from '../api/hooks';
import { ApprovalCard } from '../components/ApprovalCard';
import { EmptyState, ErrorNote, Loading, PageHeader, Tabs } from '../components/ui';

type Status = 'pending' | 'approved' | 'rejected';

export function ApprovalsPage() {
  const [status, setStatus] = useState<Status>('pending');
  const approvals = useApprovals(status, status === 'pending');

  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Agents can read the CRM on their own. Anything that changes it waits here for a person to approve."
        actions={
          <Tabs<Status>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pending', label: 'Waiting' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        }
      />
      {approvals.isLoading ? (
        <Loading />
      ) : approvals.isError ? (
        <ErrorNote error={approvals.error} />
      ) : approvals.data?.length === 0 ? (
        <EmptyState
          title={status === 'pending' ? 'Nothing is waiting for approval' : `No ${status} requests yet`}
        >
          {status === 'pending' &&
            'Ask the assistant to add a note or move a deal and the request will appear here.'}
        </EmptyState>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {approvals.data?.map((a) => (
            <ApprovalCard key={a.id} approval={a} />
          ))}
        </div>
      )}
    </>
  );
}
