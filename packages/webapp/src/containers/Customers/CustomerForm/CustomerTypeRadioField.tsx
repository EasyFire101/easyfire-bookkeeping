// @ts-nocheck
import { Button, ButtonGroup } from '@blueprintjs/core';
import { FastField } from 'formik';
import React from 'react';
import intl from 'react-intl-universal';
import { FFormGroup } from '@/components';

/**
 * Customer type selector (button group).
 */
export function CustomerTypeRadioField() {
  return (
    <FFormGroup
      name={'customer_type'}
      label={intl.get('customer_type')}
      inline
      fill
      fastField
    >
      <FastField name="customer_type">
        {({ field, form }) => (
          <ButtonGroup>
            <Button
              type="button"
              outlined
              small
              active={field.value === 'business'}
              onClick={() => {
                form.setFieldValue('customer_type', 'business');
                form.setFieldTouched('customer_type', true);
              }}
            >
              {intl.get('business')}
            </Button>
            <Button
              type="button"
              outlined
              small
              active={field.value === 'individual'}
              onClick={() => {
                form.setFieldValue('customer_type', 'individual');
                form.setFieldTouched('customer_type', true);
              }}
            >
              {intl.get('individual')}
            </Button>
          </ButtonGroup>
        )}
      </FastField>
    </FFormGroup>
  );
}
