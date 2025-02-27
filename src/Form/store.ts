import { action, observable, flow, computed } from 'mobx';
import Scheme, { ErrorList, FieldErrorList } from 'async-validator';
import { omit, isEmpty } from 'lodash-es';
import { SyntheticEvent } from 'react';
import {
  FormStoreInstance,
  ComponentStoreInstance,
  ComponentStoreProps,
  SubmitType,
  ErrorsType,
  FormStoreProps,
  ComponentStoresType,
  ErrorType,
  Rules,
  ComponentType,
  ErrorMessage,
} from './typings';

export class ComponentStore<U = any, T = {}>
  implements ComponentStoreInstance<U, T> {
  key: keyof T;

  formStore: FormStoreInstance<T>;

  defaultValue: U | undefined = undefined;

  @observable
  isChange = false;

  component: ComponentType<U>;

  @observable
  prevValue: U | undefined = undefined;

  @observable
  value: U | undefined = undefined;

  @observable
  err: ErrorType;

  @observable
  crossErr: {
    [key: string]: ErrorMessage;
  } = {};

  @computed get errors(): ErrorType {
    const errors = (this.err || []).concat(Object.values(this.crossErr));
    if (isEmpty(errors)) return undefined;
    return errors;
  }

  rules?: Rules;

  scheme?: Scheme;

  props?: {
    [key: string]: any;
  };

  constructor(props: ComponentStoreProps<U, T>) {
    const { key, formStore, defaultValue, rules, component } = props;
    this.key = key;
    this.formStore = formStore;
    this.defaultValue = defaultValue;
    this.value = defaultValue;
    this.rules = rules;
    this.component = component;
    if (rules) this.scheme = new Scheme({ [key]: rules });
  }

  @action
  setCrossErr = (props: { [key: string]: ErrorMessage }) => {
    if (this.isChange) {
      this.crossErr = {
        ...this.crossErr,
        ...props,
      };
    }
  };

  @action
  delCrossErr = (keys: string[]) => {
    this.crossErr = omit(this.crossErr, ...keys);
  };

  @action
  onChange = (value: U | Event | SyntheticEvent | undefined) => {
    let realValue: U | undefined;
    if (!isEmpty(value)) {
      if (value instanceof Event) {
        realValue = (value.target as { value?: U }).value;
      } else if ((value as SyntheticEvent).nativeEvent instanceof Event) {
        realValue = ((value as SyntheticEvent).target as { value?: U }).value;
      } else {
        realValue = value as U;
      }
    } else {
      realValue = value as U | undefined;
    }

    if (!this.isChange) {
      this.isChange = true;
      this.formStore.setChangeState(true);
    }
    this.prevValue = this.value;
    this.value = realValue;
    this.valid();
  };

  @action
  setDefaultValue = (value: U | undefined) => {
    if (!this.isChange) this.value = value;
    this.defaultValue = value;
  };

  setRules = (rules: Rules | undefined) => {
    this.rules = rules;
    if (rules) this.scheme = new Scheme({ [this.key]: rules });
    else this.scheme = undefined;
    if (this.isChange) {
      this.valid();
    }
  };

  setProps = (props: { [key: string]: any } | undefined) => {
    this.props = props;
  };

  setComponent = (component: ComponentType<U>) => {
    this.component = component;
  };

  valid = flow<Promise<ErrorType>, any[]>(function*(
    this: ComponentStore<U, T>,
  ): any {
    if (!this.isChange) {
      this.isChange = true;
      this.formStore.setChangeState(true);
    }
    let err;
    if (this.scheme) {
      const e:
        | {
            errors: ErrorList;
            fields: FieldErrorList;
          }
        | undefined = yield this.scheme
        .validate({ [this.key]: this.value })
        .catch(errs => errs);
      if (e) {
        err = (e as {
          errors: ErrorList;
          fields: FieldErrorList;
        }).errors.map(item => ({ message: item.message }));
        this.err = err;
      } else {
        this.err = e;
      }
    }
    return err;
  });

  @action
  reset = () => {
    this.isChange = false;
    this.prevValue = undefined;
    this.value = this.defaultValue;
    this.err = undefined;
    this.crossErr = {};
  };
}

export type submitReduceType<T> = [T, ErrorsType<T>];

export class FormStore<T> implements FormStoreInstance<T> {
  componentStores: ComponentStoresType<T>;

  @observable
  disabled = false;

  @action
  setDisabled = (disabled: boolean) => {
    this.disabled = disabled;
  };

  @observable
  isChange = false;

  constructor(props: FormStoreProps<T>) {
    this.componentStores = props.getInstances(this);
  }

  crossValidFuncsDict: {
    [P in keyof T]?: (() => void)[];
  } = {};

  @action
  setChangeState = (isChange: boolean) => {
    this.isChange = isChange;
  };

  submit: SubmitType<T> = callback => {
    const values: Partial<T> = {};
    for (const key in this.componentStores) {
      if (Object.prototype.hasOwnProperty.call(this.componentStores, key)) {
        this.componentStores[key].valid();
        values[key] = this.componentStores[key].value;
      }
    }
    this.valid().then(errs => {
      callback({ values, errs });
    });
  };

  reset = () => {
    for (const key in this.componentStores) {
      if (Object.prototype.hasOwnProperty.call(this.componentStores, key)) {
        this.componentStores[key].reset();
      }
    }
    this.isChange = false;
  };

  addComponentStore = <U extends ComponentStoreInstance<T[keyof T], T>>(
    component: U,
  ) => {
    if (this.componentStores[component.key]) return false;
    else {
      this.componentStores[component.key] = component;
      return true;
    }
  };

  removeComponentStore = <U extends ComponentStoreInstance<T[keyof T], T>>(
    component: U,
  ) => {
    if (this.componentStores[component.key]) {
      delete this.componentStores[component.key];
      return true;
    } else {
      return false;
    }
  };

  getValue = <U extends T[keyof T]>(key: keyof T) => {
    if (this.componentStores[key]) return this.componentStores[key].value as U | undefined;
  };

  getValues = <U extends T = T>(keys: (keyof T)[]) => {
    const values: Partial<T> = {};
    for (const key of keys) {
      if (this.componentStores[key]) values[key] = this.componentStores[key].value;
    }
    return values as Partial<U>;
  };

  setValue = (key: keyof T, value: T[keyof T]) => {
    if (this.componentStores[key]) this.componentStores[key].onChange(value);
  };

  setValues = (props: Partial<T>) => {
    for (const key in props) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        if (this.componentStores[key]) this.componentStores[key].onChange(props[key]);
      }
    }
  };

  setAllValues = (props: Partial<T>) => {
    for (const key in this.componentStores) {
      if (Object.prototype.hasOwnProperty.call(this.componentStores, key)) {
        if (props[key]) this.componentStores[key].onChange(props[key]);
        else this.componentStores[key].onChange(undefined);
      }
    }
  };

  valid = async () => {
    const errs: Partial<ErrorsType<T>> = {};
    const promiseErrors = (Object.keys(
      this.componentStores,
    ) as (keyof T)[]).map(async key => {
      return [key, await this.componentStores[key].valid()];
    }) as Promise<[keyof T, ErrorType]>[];
    await Promise.all(promiseErrors);

    for (const key in this.componentStores) {
      if (Object.prototype.hasOwnProperty.call(this.componentStores, key)) {
        const componentStore = this.componentStores[key];
        const crossValidFuncs = this.crossValidFuncsDict[key];
        if (Array.isArray(crossValidFuncs)) {
          for (const crossValidFunc of crossValidFuncs) {
            crossValidFunc();
          }
        }
        const { errors } = componentStore;
        if (errors) errs[componentStore.key] = errors;
      }
    }
    if (isEmpty(errs)) return undefined;
    return errs;
  };

  validValue = async (key: keyof T) => {
    if (!this.componentStores[key]) return undefined;
    await this.componentStores[key].valid();
    const crossValidFuncs = this.crossValidFuncsDict[key];
    if (Array.isArray(crossValidFuncs)) {
      for (const crossValidFunc of crossValidFuncs) {
        crossValidFunc();
      }
    }
    return this.componentStores[key].errors;
  };

  validValues = async <U extends ErrorsType<T> = ErrorsType<T>>(
    keys: (keyof T)[],
  ) => {
    const errs: Partial<ErrorsType<T>> = {};
    const promiseErrors = keys
      .filter(key => this.componentStores[key])
      .map(async key => {
        return [key, await this.componentStores[key].valid()];
      }) as Promise<[keyof T, ErrorType]>[];
    await Promise.all(promiseErrors);
    for (const key of keys) {
      const crossValidFuncs = this.crossValidFuncsDict[key];
      if (Array.isArray(crossValidFuncs)) {
        for (const crossValidFunc of crossValidFuncs) {
          crossValidFunc();
        }
      }
      errs[key] = this.componentStores[key].errors;
    }

    return errs as Partial<U>;
  };
}
