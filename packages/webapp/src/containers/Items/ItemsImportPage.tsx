import { DashboardInsider } from '@/components';
import { ImportView } from '../Import/ImportView';
import { useHistory } from 'react-router-dom';

export function ItemsImportpage() {
  const history = useHistory();

  const handleImportSuccess = () => {
    history.push('/items');
  };
  const handleCancelBtnClick = () => {
    history.push('/items');
  };
  return (
    <DashboardInsider name={'import-items'}>
      {/* `ImportView` types `params` as required but the @ts-nocheck original
          never passed it — preserved latent bug. */}
      {/* @ts-expect-error see comment above */}
      <ImportView
        resource={'items'}
        onImportSuccess={handleImportSuccess}
        onCancelClick={handleCancelBtnClick}
        exampleTitle="Items Example"
      />
    </DashboardInsider>
  );
}
