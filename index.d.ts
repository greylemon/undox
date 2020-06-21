import {
  Group,
  Undo,
  Redo,
  Delegate,
  CalculateState,
  DoNStatesExist
} from '.src/interfaces/internal';

import {
  Action,
  Reducer,
  Comparator,
  UndoxState,
  IgnoredActionsMap
} from '.src/interfaces/public';

import {
  UndoxTypes,
  GroupAction,
  RedoAction,
  UndoAction,
  UndoxAction
} from '.src/undox.action';

export enum UndoxTypes {
  UNDO  = 'undox/UNDO',
  REDO  = 'undox/REDO',
  GROUP = 'undox/GROUP'
}


/**
 * Undo a number of actions
 * @interface
 * @member {number} payload - The number of steps to undo (must be positive and less than the length of the past)
 */
export interface UndoAction extends Action {
  readonly type: UndoxTypes.UNDO
  payload?: number
}


/**
 * Redo a number of actions
 * @interface
 * @member {number} payload - The number of steps to redo (must be positive and less than the length of the future)
 */
export interface RedoAction extends Action {
  readonly type: UndoxTypes.REDO
  payload?: number
}


/**
 * Group actions
 * @interface
 * @member {Action[]} payload - An array of actions which will be grouped into one
 */
export interface GroupAction<A extends Action> extends Action {
  readonly type: UndoxTypes.GROUP
  payload: A[]
}

/*
 * Action Creators
 */

export const redo = (nStates = 1): RedoAction => {
  return {
    type    : UndoxTypes.REDO,
    payload : nStates
  }
}


export const undo = (nStates = 1): UndoAction => {
  return {
    type    : UndoxTypes.UNDO,
    payload : nStates
  }
}


export const group = <A extends Action>(actions: A[]): GroupAction<A> => {
  return {
    type    : UndoxTypes.GROUP,
    payload : actions
  }
}


export type UndoxAction<A extends Action>
  = UndoAction
  | RedoAction
  | GroupAction<A>
  | A



// helper used to flatten the history if grouped actions are in it
const flatten = <T> (x: (T | T[])[]) => ([] as T[]).concat(...x) as T[]

// actions can be an array of arrays because of grouped actions, so we flatten it first
const calculateState = <S, A extends Action>(reducer: Reducer<S, A>, actions: (A | A[])[], state?: S) => flatten(actions).reduce(reducer, state) as S

const getFutureActions = <S, A extends Action>(state: UndoxState<S, A>) => state.history.slice(state.index + 1)

const getPastActionsWithPresent = <S, A extends Action>(state: UndoxState<S, A>) => state.history.slice(0, state.index + 1)

const getPastActions = <S, A extends Action>(state: UndoxState<S, A>) => state.history.slice(0, state.index)

const getPresentState = <S, A extends Action>(state: UndoxState<S, A>) => state.present

export const createSelectors = <S, A extends Action>(reducer: Reducer<S, A>) => {

  return {
    getPastStates : (state: UndoxState<S, A>): S[] =>
      getPastActions(state) 
        .reduce(
          (states, a, i) =>
            Array.isArray(a)
              ? [ ...states, a.reduce(reducer, states[i - 1]) ]
              : [ ...states, reducer(states[i - 1], a) ]
          , [ ] as S[]
        ),

    getFutureStates : (state: UndoxState<S, A>): S[] =>
      getFutureActions(state)
        .reduce(
          (states, a, i) =>
            Array.isArray(a)
              ? [ ...states, a.reduce(reducer, states[i]) ]
              : [ ...states, reducer(states[i], a) ]
          , [ getPresentState(state) ]
        ).slice(1),

    getPresentState,
    getPastActions : (state: UndoxState<S, A>): A[] => flatten(getPastActions(state)),
    getPresentAction : (state: UndoxState<S, A>): A | A[] => state.history[state.index],
    getFutureActions : (state: UndoxState<S, A>): A[] => flatten(getFutureActions(state))
  }

}


const doNPastStatesExist   : DoNStatesExist = ({ history, index }, nStates) => index >= nStates
const doNFutureStatesExist : DoNStatesExist = ({ history, index }, nStates) => history.length - 1 - index >= nStates


const group: Group = (state, action, reducer, comparator) => {

  const presentState = getPresentState(state)
  const nextState = action.payload.reduce(reducer, state.present)

  if (comparator(presentState, nextState))
    return state

  return {
    history : [ ...getPastActionsWithPresent(state), action.payload ],
    index   : state.index + 1,
    present : nextState
  }

}


const undo: Undo = (reducer, state, { payload = 1 }) => {

  const nPastStatesExist = doNPastStatesExist(state, payload)
  const index = nPastStatesExist ? state.index - payload : 0

  const newState = {
    ...state,
    index
  }

  return {
    ...newState,
    present : calculateState(reducer, getPastActionsWithPresent(newState))
  }

}

const redo: Redo = (reducer, state, { payload = 1 }) => {

  const latestFuture = state.history.slice(state.index + 1, state.index + 1 + payload)

  return {
    ...state,
    index   : doNFutureStatesExist(state, payload) ? state.index + payload : state.history.length - 1, 
    present : calculateState(reducer, latestFuture, getPresentState(state))
  }

}


const delegate: Delegate = (state, action, reducer, ignoredActionsMap, comparator) => {

  const nextPresent = reducer(state.present, action)

  if (comparator(state.present, nextPresent))
    return state

  const history = [ ...getPastActionsWithPresent(state) ]

  let index = state.index

  if(!ignoredActionsMap[action.type]) {
    history.push(action)
    index++
  }

  return {
    history,
    index,
    present : nextPresent
  }

}


export const undox = <S, A extends Action>(
  reducer: Reducer<S, A>,
  initAction = { type: 'undox/INIT' } as A,
  comparator: Comparator<S> = (s1, s2) => s1 === s2,
  ignoredActionsMap: IgnoredActionsMap = {}
  ) => {
  const initialState: UndoxState<S, A> = {
    history : [ initAction ],
    present : reducer(undefined, initAction),
    index   : 0
  }
  
  return (state = initialState, action: UndoxAction<A>) => {

    switch (action.type) {

      case UndoxTypes.UNDO:
        return undo(reducer, state, action as UndoAction)

      case UndoxTypes.REDO:
        return redo(reducer, state, action as RedoAction)

      case UndoxTypes.GROUP:
        return group(state, action as GroupAction<A>, reducer, comparator)

      default:
        return delegate(state as UndoxState<S, A>, action as A, reducer, ignoredActionsMap, comparator)

    }

  }

}

export interface DoNStatesExist {
  <S, A extends Action>(state: UndoxState<S, A>, nStates: number): boolean
}

export interface CalculateState {
  <S, A extends Action>(reducer: Reducer<S, A>, actions: (A | A[])[], state?: S): S
}

export interface Undo {
  <S, A extends Action>(reducer: Reducer<S, A>, state: UndoxState<S, A>, action: UndoAction): UndoxState<S, A>
}

export interface Redo {
  <S, A extends Action>(reducer: Reducer<S, A>, state: UndoxState<S, A>, action: RedoAction): UndoxState<S, A>
}

export interface Group {
  <S, A extends Action>(state: UndoxState<S, A>, action: GroupAction<A>, reducer: Reducer<S, A>, comparator: Comparator<S>): UndoxState<S, A>
}

export interface Delegate {
  <S, A extends Action>(state: UndoxState<S, A>, action: A, reducer: Reducer<S, A>, ignoredActionsMap: IgnoredActionsMap, comparator: Comparator<S>): UndoxState<S, A>
}

import {
  UndoxAction,
  RedoAction,
  UndoAction
} from '../undox.action'


/**
 * A simple Redux Action
 */
export interface Action<T = any> {
  type     : T
  payload? : any
}

/**
 * The Reducer which is passed to the Undox Reducer.
 * 
 * @template S State object type.
 * @template A Action object type.
 * 
 */
export interface Reducer<S =  any, A extends Action = Action> {
  (state: S | undefined, action: A): S
}

/**
 * The State object type of the undox reducer
 * 
 * @template S State object type.
 * @template A Action object type.
 * 
 * @member history An Array of Action objects that represent the history in the order: [...past, present, ...future]
 * @member index The index which represents the present
 * 
 */
export interface UndoxState<S, A extends Action> {
  history : ReadonlyArray<(A | A[])>
  index   : Readonly<number>
  present : Readonly<S>
}

/**
 * 
 * A function which compares two states in order to detect state changes.
 * If it evaluates to true, the action history is not updated and the state is returned.
 * If it evaluates to false, the action history is updated and the new state is returned.
 * The default comparator uses strict equality (s1, s2) => s1 === s2.
 * To add every action to the history one would provide the comparatar (s1, s2) => false.
 * 
 * @template S State object type.
 * 
 */
export type Comparator<S> = (s1: S, s2: S) => boolean

export type IgnoredActionsMap = {
  [ key: string ]: boolean
}
