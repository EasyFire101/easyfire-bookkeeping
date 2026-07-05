// @ts-nocheck
import { Classes, Button, Intent } from '@blueprintjs/core';
import { FormGroup, InputGroup } from '@blueprintjs/core';
import { Form, useFormikContext } from 'formik';
import { FastField, ErrorMessage } from 'formik';
import React from 'react';
import intl from 'react-intl-universal';
import { FFormGroup, FInputGroup, FormattedMessage as T } from '@/components';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { inputIntent } from '@/utils';
import { compose } from '@/utils';

/**
 * API Keys Generate form content.
 */
function ApiKeysGenerateFormContentInner({
  dialogName,
  // #withDialogActions
  closeDialog,
}) {
  const { isSubmitting } = useFormikContext();

  const handleClose = () => {
    closeDialog(dialogName);
  };

  return (
    <Form>
      <div className={Classes.DIALOG_BODY}>
        {/* ----------- Name ----------- */}
        <FFormGroup name={'name'} label={intl.get('api_key.name')}>
          <FInputGroup
            name={'name'}
            placeholder={intl.get('api_key.name_placeholder')}
          />
        </FFormGroup>
      </div>

      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button onClick={handleClose} disabled={isSubmitting}>
            <T id={'cancel'} />
          </Button>

          <Button
            intent={Intent.PRIMARY}
            type="submit"
            disabled={isSubmitting}
            loading={isSubmitting}
            style={{ minWidth: '100px' }}
          >
            <T id={'api_key.generate'} />
          </Button>
        </div>
      </div>
    </Form>
  );
}

export const ApiKeysGenerateFormContent = compose(withDialogActions)(
  ApiKeysGenerateFormContentInner,
);
