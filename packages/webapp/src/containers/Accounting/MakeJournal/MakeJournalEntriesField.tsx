import React from 'react';
import { FastField, type FieldProps } from 'formik';
import classNames from 'classnames';
import { CLASSES } from '@/constants/classes';
import {
  entriesFieldShouldUpdate,
  defaultEntry,
  MIN_LINES_NUMBER,
  type MakeJournalEntry,
  type MakeJournalFormValues,
} from './utils';
import { useMakeJournalFormContext } from './MakeJournalProvider';
import { MakeJournalEntriesTable } from './MakeJournalEntriesTable';

/**
 * Make journal entries field.
 */
export function MakeJournalEntriesField() {
  const { accounts, contacts, branches, projects } =
    useMakeJournalFormContext();

  return (
    <div className={classNames(CLASSES.PAGE_FORM_BODY)}>
      <FastField
        name={'entries'}
        contacts={contacts}
        accounts={accounts}
        branches={branches}
        projects={projects}
        shouldUpdate={entriesFieldShouldUpdate}
      >
        {({
          form: { values, setFieldValue },
          field: { value },
          meta: { error },
        }: FieldProps<MakeJournalEntry[], MakeJournalFormValues>) => (
          <MakeJournalEntriesTable
            onChange={(entries) => {
              setFieldValue('entries', entries);
            }}
            entries={value ?? []}
            defaultEntry={defaultEntry}
            initialLinesNumber={MIN_LINES_NUMBER}
            error={error}
            currencyCode={values.currencyCode}
          />
        )}
      </FastField>
    </div>
  );
}
