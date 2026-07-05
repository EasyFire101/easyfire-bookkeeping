// @ts-nocheck
import { Intent } from '@blueprintjs/core';
import React, { useCallback } from 'react';
import intl from 'react-intl-universal';
import { ActionsMenu, useApiKeysTableColumns } from './components';
import { DataTable, TableSkeletonRows, AppToaster } from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useApiKeys, useRevokeApiKey } from '@/hooks/query';
import { compose } from '@/utils';


/**
 * API Keys datatable.
 */
function ApiKeysDataTableInner({
  // #withDialogActions
  openDialog,

  // #withAlertActions
  openAlert,
}) {
  const { data: apiKeys, isLoading, isFetching } = useApiKeys();
  const { mutateAsync: revokeApiKey } = useRevokeApiKey();

  // API Keys list columns.
  const columns = useApiKeysTableColumns();

  // Handle revoke API key action.
  const handleRevokeApiKey = useCallback(
    (apiKey) => {
      revokeApiKey(apiKey.id)
        .then(() => {
          AppToaster.show({
            message: intl.get('api_key.revoke_success'),
            intent: Intent.SUCCESS,
          });
        })
        .catch((error) => {
          AppToaster.show({
            message:
              error?.response?.data?.message ||
              intl.get('something_went_wrong'),
            intent: Intent.DANGER,
          });
        });
    },
    [revokeApiKey],
  );

  return (
    <DataTable
      columns={columns}
      data={apiKeys || []}
      loading={isLoading}
      headerLoading={isLoading}
      progressBarLoading={isFetching}
      TableLoadingRenderer={TableSkeletonRows}
      noInitialFetch={true}
      ContextMenu={ActionsMenu}
      payload={{
        onRevoke: handleRevokeApiKey,
      }}
    />
  );
}

export const ApiKeysDataTable = compose(
  withDialogActions,
  withAlertActions,
)(ApiKeysDataTableInner);
