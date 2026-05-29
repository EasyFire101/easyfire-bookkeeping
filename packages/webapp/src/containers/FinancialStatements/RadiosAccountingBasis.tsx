import React from 'react';
import intl from 'react-intl-universal';
import { FastField } from 'formik';
import { handleStringChange } from '@/utils';
import { RadioGroup, Radio } from '@blueprintjs/core';

interface RadiosAccountingBasisProps {
  key?: string;
  [key: string]: unknown;
}

export function RadiosAccountingBasis(props: RadiosAccountingBasisProps) {
  const { key = 'basis', ...rest } = props;

  return (
    <FastField name={'basis'}>
      {({
        form: { setFieldValue },
        field: { value },
      }: any) => (
        <RadioGroup
          inline={true}
          label={intl.get('accounting_basis')}
          name="basis"
          onChange={handleStringChange((value: string) => {
            setFieldValue(key, value);
          })}
          className={'radio-group---accounting-basis'}
          selectedValue={value}
          {...rest}
        >
          <Radio label={intl.get('cash')} value="cash" />
          <Radio label={intl.get('accrual')} value="accrual" />
        </RadioGroup>
      )}
    </FastField>
  );
}
