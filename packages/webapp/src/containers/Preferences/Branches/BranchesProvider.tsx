import React, { ReactNode } from 'react';
import classNames from 'classnames';
import { BranchesListResponse } from '@bigcapital/sdk-ts';
import { CLASSES } from '@/constants/classes';
import { useBranches } from '@/hooks/query';
import { useFeatureCan } from '@/hooks/state';
import { Features } from '@/constants';
import { isEmpty } from 'lodash';

interface BranchesContextValue {
  branches: BranchesListResponse | undefined;
  isBranchesLoading: boolean;
  isEmptyStatus: boolean;
}

const BranchesContext = React.createContext<BranchesContextValue>(
  {} as BranchesContextValue,
);

interface BranchesProviderProps {
  query?: Record<string, unknown>;
  children: ReactNode;
}

function BranchesProvider({ query, ...props }: BranchesProviderProps) {
  // Features guard.
  const { featureCan } = useFeatureCan();
  const isBranchFeatureCan = featureCan(Features.Branches);

  // Fetches the branches list.
  const {
    isLoading: isBranchesLoading,
    data: branches,
  } = useBranches(query, { enabled: isBranchFeatureCan });

  // Detarmines the datatable empty status.
  const isEmptyStatus =
    (isEmpty(branches) && !isBranchesLoading) || !isBranchFeatureCan;

  // Provider state.
  const provider: BranchesContextValue = {
    branches,
    isBranchesLoading,
    isEmptyStatus,
  };

  return (
    <div
      className={classNames(
        CLASSES.PREFERENCES_PAGE_INSIDE_CONTENT,
        CLASSES.PREFERENCES_PAGE_INSIDE_CONTENT_BRANCHES,
      )}
    >
      <BranchesContext.Provider value={provider} {...props} />
    </div>
  );
}

const useBranchesContext = () =>
  React.useContext<BranchesContextValue>(BranchesContext);

export { BranchesProvider, useBranchesContext };
