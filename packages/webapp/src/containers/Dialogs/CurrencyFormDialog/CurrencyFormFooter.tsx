// @ts-nocheck

import { Button, Classes, Intent } from '@blueprintjs/core';
import { useFormikContext } from 'formik';
import React from 'react';
import { useCurrencyFormContext } from './CurrencyFormProvider';
import { FormattedMessage as T } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { compose } from '@/utils';

/**
 * Currency dialog form footer action.
 */
function CurrencyFormFooterInner({
  // #withDialogActions
  closeDialog,
}) {
  const { isSubmitting } = useFormikContext();

  const { dialogName, isEditMode } = useCurrencyFormContext();

  const handleClose = () => {
    closeDialog(dialogName);
  };

  return (
    <div className={Classes.DIALOG_FOOTER}>
      <div className={Classes.DIALOG_FOOTER_ACTIONS}>
        <Button onClick={handleClose} disabled={isSubmitting}>
          <T id={'cancel'} />
        </Button>
        <Button intent={Intent.PRIMARY} type="submit" loading={isSubmitting}>
          {!isEditMode ? <T id={'submit'} /> : <T id={'edit'} />}
        </Button>
      </div>
    </div>
  );
}

export const CurrencyFormFooter = compose(withDialogActions)(
  CurrencyFormFooterInner,
);
