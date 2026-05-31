// @ts-nocheck
import React from 'react';
import intl from 'react-intl-universal';
import { ControlGroup } from '@blueprintjs/core';
import { FFormGroup, FInputGroup } from '@/components';

export function CustomerFormAfterPrimarySection({}) {
  return (
    <div>
      {/*------------ Customer email -----------*/}
      <FFormGroup
        name={'email'}
        label={intl.get('customer_email')}
        inline
        fill
      >
        <FInputGroup name={'email'} fill />
      </FFormGroup>

      {/*------------ Phone number -----------*/}
      <FFormGroup
        name={'personal_phone'}
        label={intl.get('phone_number')}
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
        label={intl.get('website')}
        inline
        fill
      >
        <FInputGroup name={'website'} placeholder={'http://'} fill />
      </FFormGroup>
    </div>
  );
}
