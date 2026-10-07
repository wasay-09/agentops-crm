import { Link } from 'react-router';
import { usePrompts } from '../api/hooks';
import { Card, EmptyState, ErrorNote, Loading, PageHeader, Table } from '../components/ui';
import { formatRelative } from '../lib/format';
import { describeDeployment } from '../lib/weights';

export function PromptsPage() {
  const prompts = usePrompts();
  return (
    <>
      <PageHeader
        title="Prompts"
        subtitle="Versions are immutable. Deployment weights decide which version each run gets, so you can A/B test or roll back without a deploy."
      />
      {prompts.isLoading ? (
        <Loading />
      ) : prompts.isError ? (
        <ErrorNote error={prompts.error} />
      ) : prompts.data?.length === 0 ? (
        <EmptyState title="No prompts registered" />
      ) : (
        <Card flush>
          <Table head={['Prompt', 'Description', 'Versions', 'Deployment', 'Changed']}>
            {prompts.data?.map((p) => (
              <tr key={p.name} className="hover:bg-sunken/60">
                <td>
                  <Link
                    to={`/prompts/${encodeURIComponent(p.name)}`}
                    className="font-mono text-[13px] text-accent hover:underline"
                  >
                    {p.name}
                  </Link>
                </td>
                <td className="max-w-80 text-muted">{p.description ?? '—'}</td>
                <td className="num">{p.versions.length}</td>
                <td className="num text-xs">{describeDeployment(p.deployment)}</td>
                <td className="whitespace-nowrap text-muted">{formatRelative(p.deploymentUpdatedAt)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
