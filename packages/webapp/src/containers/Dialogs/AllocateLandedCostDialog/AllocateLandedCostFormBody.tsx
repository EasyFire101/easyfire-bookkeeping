// @ts-nocheck
import classNames from 'classnames';
import { FastField } from 'formik';
import React from 'react';
import { AllocateLandedCostEntriesTable } from './AllocateLandedCostEntriesTable';
import { CLASSES } from '@/constants/classes';

export function AllocateLandedCostFormBody() {
  return (
    <div className={classNames(CLASSES.PAGE_FORM_BODY)}>
      <FastField name={'items'}>
        {({
          form: { setFieldValue, values },
          field: { value },
          meta: { error, touched },
        }) => (
          <AllocateLandedCostEntriesTable
            entries={value}
            onUpdateData={(newEntries) => {
              setFieldValue('items', newEntries);
            }}
          />
        )}
      </FastField>
    </div>
  );
}
