import { ImportView } from '../Import/ImportView';
import { DashboardInsider } from '@/components';

export function ItemsImport() {
  return (
    <DashboardInsider name={'import-items'}>
      {/* `ImportView` types `params` as required but the @ts-nocheck original
          never passed it — preserved latent bug. */}
      {/* @ts-expect-error see comment above */}
      <ImportView resource={'items'} />
    </DashboardInsider>
  );
}
