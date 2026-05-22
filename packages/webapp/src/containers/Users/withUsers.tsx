import { connect } from 'react-redux';
import { getExpensesCurrentPageFactory } from '@/store/users/users.selectors';
import { ApplicationState } from '@/store/reducers';
import type { MapState } from '@/containers/hoc.types';

export interface WithUsersProps {
  usersList: ReturnType<typeof getExpensesCurrentPageFactory>;
  usersLoading: boolean;
}

export const withUsers = <Props,>(mapState?: MapState<WithUsersProps, Props>) => {
  const mapStateToProps = (state: ApplicationState, props: Props) => {
    const mapped: WithUsersProps = {
      usersList: getExpensesCurrentPageFactory(state),
      usersLoading: state.users.loading,
    };
    return mapState ? mapState(mapped, state, props) : mapped;
  };

  return connect(mapStateToProps);
};
