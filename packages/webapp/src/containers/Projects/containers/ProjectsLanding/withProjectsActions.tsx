import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import type { TableQuery } from '@/store/store.types';
import {
  setProjectsTableState,
  resetProjectsTableState,
} from '@/store/project/projects.actions';

export interface WithProjectsActionsProps {
  setProjectsTableState: (state: Partial<TableQuery>) => void;
  resetProjectsTableState: () => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithProjectsActionsProps => ({
  setProjectsTableState: (state: Partial<TableQuery>) =>
    dispatch(setProjectsTableState(state)),
  resetProjectsTableState: () => dispatch(resetProjectsTableState()),
});

export const withProjectsActions = connect(null, mapDispatchToProps);
