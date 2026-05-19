// @ts-nocheck
import { defaultTo } from 'lodash';
import { createSelector } from '@reduxjs/toolkit';

const getCurrentOrganizationId = (state) => state.authentication.organizationId;
const getOrganizationsMap = (state) => state.organizations.data;
const getOrganizationsByOrgIdMap = (state) =>
  state.organizations.byOrganizationId;

// Retrieve organization id.
export const getOrganizationIdFactory = () =>
  createSelector(getCurrentOrganizationId, (organizationId) => organizationId);

// Retrieve current organization meta object.
export const getCurrentOrganizationFactory = () =>
  createSelector(
    getCurrentOrganizationId,
    getOrganizationsByOrgIdMap,
    getOrganizationsMap,
    (organizationId, byOrganizationId, organizationsMap) => {
      const tenantId = byOrganizationId?.[organizationId];
      return defaultTo(organizationsMap[tenantId], {});
    },
  );
