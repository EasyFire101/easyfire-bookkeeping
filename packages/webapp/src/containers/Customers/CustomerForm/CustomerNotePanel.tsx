// @ts-nocheck
import React from 'react';
import { FFormGroup, FTextArea } from '@/components';
import intl from 'react-intl-universal';

export function CustomerNotePanel({ errors, touched, getFieldProps }) {
  return (
    <FFormGroup name={'note'} label={intl.get('note')} inline={false} fill>
      <FTextArea name={'note'} fill />
    </FFormGroup>
  );
}
