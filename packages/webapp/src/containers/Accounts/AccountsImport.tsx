import { DashboardInsider } from '@/components';
import { ImportView } from '../Import/ImportView';
import { useHistory } from 'react-router-dom';

export function AccountsImport() {
  const history = useHistory();

  const handleCancelBtnClick = () => {
    history.push('/accounts');
  };
  const handleImportSuccess = () => {
    history.push('/accounts');
  };

  return (
    <DashboardInsider name={'import-accounts'}>
      {/* `ImportView` types `params` as required but the @ts-nocheck original
          never passed it — preserved latent bug. */}
      {/* @ts-expect-error see comment above */}
      <ImportView
        resource={'accounts'}
        onCancelClick={handleCancelBtnClick}
        onImportSuccess={handleImportSuccess}
      />
    </DashboardInsider>
  );
}
