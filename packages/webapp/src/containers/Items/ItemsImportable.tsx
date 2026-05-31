// @ts-nocheck
import { DashboardInsider } from '@/components';
import { ImportView } from '../Import/ImportView';

export function ItemsImport() {
  return (
    <DashboardInsider name={'import-items'}>
      <ImportView resource={'items'} />
    </DashboardInsider>
  );
}
