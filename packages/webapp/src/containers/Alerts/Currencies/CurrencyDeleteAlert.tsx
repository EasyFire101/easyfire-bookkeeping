// @ts-nocheck
import { Intent, Alert } from '@blueprintjs/core';
import React from 'react';
import intl from 'react-intl-universal';
import {
  AppToaster,
  FormattedMessage as T,
  FormattedHTMLMessage,
} from '@/components';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import { withAlertStoreConnect } from '@/containers/Alert/withAlertStoreConnect';
import { useDeleteCurrency } from '@/hooks/query';
import { compose } from '@/utils';

/**
 * Currency delete alerts.
 */
function CurrencyDeleteAlertInner({
  name,

  // #withAlertStoreConnect
  isOpen,
  payload: { currency_code },

  // #withAlertActions
  closeAlert,
}) {
  const { mutateAsync: deleteCurrency, isLoading } = useDeleteCurrency();

  // handle cancel delete currency alert.
  const handleCancelCurrencyDelete = () => closeAlert(name);

  // handle alert confirm delete currency.
  const handleConfirmCurrencyDelete = () => {
    deleteCurrency(currency_code)
      .then((response) => {
        AppToaster.show({
          message: intl.get('the_currency_has_been_deleted_successfully'),
          intent: Intent.SUCCESS,
        });
        closeAlert(name);
      })
      .catch(({ data: { errors } }) => {
        if (errors.find((e) => e.type === 'CANNOT_DELETE_BASE_CURRENCY')) {
          AppToaster.show({
            intent: Intent.DANGER,
            message: 'Cannot delete the base currency.',
          });
        }
        closeAlert(name);
      });
  };

  return (
    <Alert
      cancelButtonText={<T id={'cancel'} />}
      confirmButtonText={<T id={'delete'} />}
      intent={Intent.DANGER}
      isOpen={isOpen}
      onCancel={handleCancelCurrencyDelete}
      onConfirm={handleConfirmCurrencyDelete}
      loading={isLoading}
    >
      <p>
        <FormattedHTMLMessage
          id={'once_delete_this_currency_you_will_able_to_restore_it'}
        />
      </p>
    </Alert>
  );
}

export const CurrencyDeleteAlert = compose(
  withAlertStoreConnect(),
  withAlertActions,
)(CurrencyDeleteAlertInner);
