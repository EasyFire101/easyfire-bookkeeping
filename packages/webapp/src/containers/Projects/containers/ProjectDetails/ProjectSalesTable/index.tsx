// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import { ProjectSalesTable } from './ProjectSalesTable';
import { DashboardContentTable } from '@/components';

/**
 * Project Sales Table.
 * @returns
 */
export function ProjectSalesTableRoot() {
  return (
    <ProjectSalesContentTable>
      <ProjectSalesTable />
    </ProjectSalesContentTable>
  );
}

const ProjectSalesContentTable = styled(DashboardContentTable)``;
