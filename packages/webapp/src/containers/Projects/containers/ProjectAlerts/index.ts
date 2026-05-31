// @ts-nocheck
import React from 'react';

const ProjectDeleteAlert = React.lazy(() => import('./ProjectDeleteAlert').then(m => ({ default: m.ProjectDeleteAlert })));
const ProjectTaskDeleteAlert = React.lazy(() => import('./ProjectTaskDeleteAlert').then(m => ({ default: m.ProjectTaskDeleteAlert })));
const ProjectTimesheetDeleteAlert = React.lazy(() => import('./ProjectTimesheetDeleteAlert').then(m => ({ default: m.ProjectTimesheetDeleteAlert })));

const ProjectStatusAlert = React.lazy(() => import('./ProjectStatusAlert').then(m => ({ default: m.ProjectStatusAlert })));

/**
 * Project alerts.
 */
export const ProjectAlerts = [
  { name: 'project-delete', component: ProjectDeleteAlert },
  { name: 'project-task-delete', component: ProjectTaskDeleteAlert },
  { name: 'project-timesheet-delete', component: ProjectTimesheetDeleteAlert },
  { name: 'project-status', component: ProjectStatusAlert },
];
