// @ts-nocheck
import React from 'react';

const JournalDeleteAlert = React.lazy(() => import('@/containers/Alerts/ManualJournals/JournalDeleteAlert').then(m => ({ default: m.JournalDeleteAlert })));
const JournalPublishAlert = React.lazy(() => import('@/containers/Alerts/ManualJournals/JournalPublishAlert').then(m => ({ default: m.JournalPublishAlert })));

/**
 * Manual journals alerts.
 */

export const ManualJournalsAlerts = [
  { name: 'journal-delete', component: JournalDeleteAlert },
  { name: 'journal-publish', component: JournalPublishAlert },
];
