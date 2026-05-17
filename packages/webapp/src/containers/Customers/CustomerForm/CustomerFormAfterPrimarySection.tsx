// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import { ControlGroup } from '@blueprintjs/core';
import { FormattedMessage as T, FFormGroup, FInputGroup } from '@/components';

export default function CustomerFormAfterPrimarySection({}) {
  return (
    <div>
      {/*------------ Customer email -----------*/}
      <FFormGroup
        name={'email'}
        label={<T id={'customer_email'} />}
        inline
        fill
      >
        <FInputGroup name={'email'} fill />
      </FFormGroup>

      {/*------------ Phone number -----------*/}
      <FFormGroup
        name={'personal_phone'}
        label={<T id={'phone_number'} />}
        inline
        fill
      >
        <ControlGroup fill>
          <FInputGroup
            name={'personal_phone'}
            placeholder={intl.get('personal')}
            fill
          />
          <FInputGroup
            name={'work_phone'}
            placeholder={intl.get('work')}
            fill
          />
        </ControlGroup>
      </FFormGroup>

      {/*------------ Customer website -----------*/}
      <FFormGroup
        name={'website'}
        label={<T id={'website'} />}
        inline
        fill
      >
        <FInputGroup name={'website'} placeholder={'http://'} fill />
      </FFormGroup>
    </div>
  );
}
