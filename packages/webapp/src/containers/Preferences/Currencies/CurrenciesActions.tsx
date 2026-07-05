// @ts-nocheck
import { Button, Intent } from '@blueprintjs/core';
import React, { useCallback } from 'react';
import { Icon, FormattedMessage as T } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';

function CurrenciesActionsInner({ openDialog }) {
  const handleClickNewCurrency = useCallback(() => {
    openDialog('currency-form');
  }, [openDialog]);

  return (
    <div class="users-actions">
      <Button
        icon={<Icon icon="plus" iconSize={12} />}
        onClick={handleClickNewCurrency}
        intent={Intent.PRIMARY}
      >
        <T id={'new_currency'} />
      </Button>
    </div>
  );
}

export const CurrenciesActions = compose(withDialogActions)(
  CurrenciesActionsInner,
);
