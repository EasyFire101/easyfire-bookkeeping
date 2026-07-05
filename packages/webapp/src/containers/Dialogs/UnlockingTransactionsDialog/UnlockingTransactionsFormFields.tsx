// @ts-nocheck
import { Classes, FormGroup, TextArea } from '@blueprintjs/core';
import { FastField, ErrorMessage } from 'formik';
import React from 'react';
import intl from 'react-intl-universal';
import { FieldRequiredHint } from '@/components';
import { useAutofocus } from '@/hooks';
import { inputIntent } from '@/utils';

/**
 * Unlocking transactions form fields.
 */
export function UnlockingTransactionsFormFields() {
  const reasonFieldRef = useAutofocus();

  return (
    <div className={Classes.DIALOG_BODY}>
      {/*------------ Locking  Reason -----------*/}
      <FastField name={'reason'}>
        {({ field, meta: { error, touched } }) => (
          <FormGroup
            label={intl.get('unlocking_transactions.dialog.reason')}
            labelInfo={<FieldRequiredHint />}
            className={'form-group--reason'}
            intent={inputIntent({ error, touched })}
            helperText={<ErrorMessage name={'reason'} />}
          >
            <TextArea
              growVertically={true}
              large={true}
              intent={inputIntent({ error, touched })}
              inputRef={(ref) => (reasonFieldRef.current = ref)}
              {...field}
            />
          </FormGroup>
        )}
      </FastField>
    </div>
  );
}
