import {Component, Input, Output, ChangeDetectionStrategy, EventEmitter} from '@angular/core';
import {BindingInputBase} from '../shared/models/binding-input';
import {PortalService} from '../shared/services/portal.service';
import {UserService} from '../shared/services/user.service';
import {PickerInput} from '../shared/models/binding-input';
import {BroadcastService} from '../shared/services/broadcast.service';
import {BroadcastEvent} from '../shared/models/broadcast-event'
import {SettingType, ResourceType, UIFunctionBinding} from '../shared/models/binding';
import {DropDownElement} from '../shared/models/drop-down-element';
import {TranslateService, TranslatePipe} from 'ng2-translate/ng2-translate';
import {PortalResources} from '../shared/models/portal-resources';
import {GlobalStateService} from '../shared/services/global-state.service';
import {FunctionInfo} from '../shared/models/function-info';
import {Subscription, Subject} from 'rxjs/Rx';

@Component({
  selector: 'binding-input',
  templateUrl: './binding-input.component.html',
  styleUrls: ['./binding-input.component.css'],
  inputs: ["selectedFunction", "input"]
})
export class BindingInputComponent {
    @Input() binding: UIFunctionBinding;
    @Output() validChange = new EventEmitter<BindingInputBase<any>>(false);
    public disabled: boolean;
    public enumInputs: DropDownElement<any>[];
    public description: string;
    public functionReturnValue: boolean;
    private _input: BindingInputBase<any>;
    private showTryView: boolean;
    private _functionSelectStream = new Subject<FunctionInfo>();
    private _functionInfo : FunctionInfo;

    constructor(
        private _portalService: PortalService,
        private _broadcastService: BroadcastService,
        private _userService: UserService,
        private _translateService: TranslateService,
        private _globalStateService: GlobalStateService) {
        this.showTryView = this._globalStateService.showTryView;

        this._functionSelectStream
            .distinctUntilChanged()
            .switchMap(fi =>{
                this._functionInfo = fi;
                return this._functionInfo.functionApp.checkIfDisabled();
            })
            .subscribe(disabled =>{
                this.disabled = disabled;
            })
    }

    set selectedFunction(fi : FunctionInfo){
        this._functionSelectStream.next(fi);
    }

    set input(input: BindingInputBase<any>) {
        if (input.type === SettingType.picker) {
            var picker = <PickerInput>input;
            if (!input.value && picker.items) {
                input.value = picker.items[0];
            }
        }

        this._input = input;
        this.setBottomDescription(this._input.id, this._input.value);

        this.setClass(input.value);
        if (this._input.type === SettingType.enum) {
            var enums: { display: string; value: any }[] = (<any>this._input).enum;
            this.enumInputs = enums
                .map(e => ({ displayLabel: e.display, value: e.value, default: this._input.value === e.value }));
        }

        if ((input.id === 'name') && (input.value === '$return')) {
            this.functionReturnValue = true;
            this.disabled = true;
        }
    }

    get input(): BindingInputBase<any> {
        return this._input;
    }

    openCollectorBlade(input: PickerInput) {
        let name = "";
        let bladeInput = null;

        switch (input.resource) {
            case ResourceType.Storage:
                name = "StorageAccountPickerBlade";
                break;
            case ResourceType.EventHub:
                name = "CustomConnectionPickerBlade";
                break;
            case ResourceType.DocumentDB:
                name = "DocDbPickerBlade";
                break;
            case ResourceType.ServiceBus:
                name = "NotificationHubPickerBlade";
                break;
            case ResourceType.ApiHub:
                bladeInput = input.metadata;
                bladeInput.bladeName = "CreateDataConnectionBlade";
                break;
        }

        // for tests
        if (window.location.hostname === "localhost" && !this._userService.inIFrame) {
            this.input.value = name;
            this.inputChanged(name);
            this.setClass(name);
            return;
        }

        if (!this._userService.inIFrame) {
            return;
        }

        var picker = <PickerInput>this.input;
        picker.inProcess = true;
        this._globalStateService.setBusyState(this._translateService.instant(PortalResources.resourceSelect));

        if (bladeInput) {
            this._portalService.openCollectorBladeWithInputs(
                this._functionInfo.functionApp.site.id,
                bladeInput,
                "binding-input",
                (appSettingName: string) => {
                    this.finishResourcePickup(appSettingName, picker);
            });
        } else {
            this._portalService.openCollectorBlade(
                this._functionInfo.functionApp.site.id,
                name,
                "binding-input",
                (appSettingName: string) => {
                    this.finishResourcePickup(appSettingName, picker);
            });
        }
    }

    inputChanged(value: any) {
        this.setBottomDescription(this._input.id, value);

        if (this._input.changeValue) {
            this._input.changeValue(value);
        }
        this.setClass(value);
        this._broadcastService.broadcast(BroadcastEvent.IntegrateChanged);
    }

    onDropDownInputChanged(value: any) {
        this._input.value = value;
        this.inputChanged(value);
    }

    functionReturnValueChanged(value: any) {
        if (value) {
            this._input.value = '$return';
            this.inputChanged('$return');
        }
        this.disabled = value;
    }

    private setClass(value: any) {
        if (this._input) {
            this._input.class = this.input.noErrorClass;
            var saveValid = this._input.isValid;

            if (this._input.required) {
                this._input.isValid = (value) ? true : false;
                this._input.class = this._input.isValid ? this._input.noErrorClass : this._input.errorClass;

                this._input.errorText = this._input.isValid ? "" : this._translateService.instant(PortalResources.filedRequired);

            } else {
                this._input.isValid = true;
                this._input.errorText = "";
            }

            if (this._input.isValid && this._input.validators) {
                this._input.validators.forEach((v) => {
                    var regex = new RegExp(v.expression);
                    if (!regex.test(value)) {
                        this._input.isValid = false;
                        this._input.class = this._input.errorClass;
                        this._input.errorText = v.errorText;
                    }
                });
            }

            if (saveValid !== this._input.isValid) {
                this.validChange.emit(this._input);
            }

        }
    }

    private finishResourcePickup(appSettingName: string, picker: PickerInput) {
        if (appSettingName) {

            var existedAppSetting;
            if (picker.items) {
                existedAppSetting = picker.items.find((item) => {
                    return item === appSettingName;
                });
            }

            this.input.value = appSettingName;
            if (!existedAppSetting) {
                picker.items.splice(0, 0, this.input.value);
            }
            this.inputChanged(name);
            this.setClass(appSettingName);
        }
        picker.inProcess = false;
        this._globalStateService.clearBusyState();
    }

    setBottomDescription(id: string, value: any) {
        switch (id) {
            // TODO: Temporarily hide cron expression string
            //https://github.com/projectkudu/AzureFunctionsPortal/issues/398
            //case "schedule":
            //    this.description = prettyCron.toString(value);
        }
    }
}