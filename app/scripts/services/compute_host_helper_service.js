// (c) Copyright 2016-2017 Hewlett Packard Enterprise Development LP
// (c) Copyright 2017 SUSE LLC
(function (ng) {
    'use strict';
    ng.module('operations-ui').service('computeHostHelperService', [
        'bllApiRequest','ArdanaService', '$rootScope', '$q', '$translate',
        'addNotification', 'log', 'AnsiColoursService', '$timeout', 'getRegions',
        function (bllApiRequest, ArdanaService, $rootScope, $q, $translate,
                  addNotification, log, AnsiColoursService, $timeout, getRegions) {

        //this service intends to serve the common functions that could be used
        //anywhere. The code moved from compute_nodes.js
        //actions for HOS (HLM) are moved, not for cs. Will do cs actions later.
        var self = this;

        this.isValidToEnableGlobalAction = function(data, actionName) {
            if(actionName === 'globalActionAddCompute') {
                if (angular.isDefined(self.blockActionFlag) &&
                    self.blockActionFlag === true) {
                    return false;
                }
            }

            return true;
        };

        this.isValidToShowComputeHostAction = function(data, actionName) {
            if (!angular.isDefined(data) || !angular.isDefined(actionName) ||
                (angular.isDefined(self.blockActionFlag) &&
                 self.blockActionFlag === true)) {
                return false;
            }

            //logic leverage from compute_nodes.js
            //TODO need revisit logic
            if (data.state.match("ing$") == 'ing') {
                  return false;
            }
            else if (actionName === "deactivate" &&
                    (data.state === "deactivated" || data.state === "deleted" ||
                     data.state === 'imported' || data.state === 'provisioned')) {
                return false;
            }
            else if (actionName === "delete" &&
                    (data.state === "deleted" || data.state === "activated")) {
                return false;
            }
            else if (actionName === "delete" && data.type === "esxcluster") {
               return false;
            }
            else if (actionName === "activate" &&
                    (data.state === "activated" || data.state === "deleted")) {
                return false;
            }

            return true;
        };

        //deal with actions for HOS using HLM
        this.askEncryptionModalHLM = {
            _show: false,
            show: function () {
                if (!ArdanaService.isConfigEncrypted()) {
                    return $q.when('');
                }

                if (self.askEncryptionModalHLM._show) {
                    return $q.reject('Singleton pattern for ask encryption modal');
                }

                self.askEncryptionModalHLM._show = true;
                self.askEncryptionModalHLM._showDeferred = $q.defer();
                return self.askEncryptionModalHLM._showDeferred.promise;
            },
            stackableScope: {
                values: {},
                clearAndClose: function (ok) {
                    self.askEncryptionModalHLM._show = false;

                    if (ok) {
                        self.askEncryptionModalHLM._showDeferred
                            .resolve(self.askEncryptionModalHLM.stackableScope.values.encryptionKey);
                    } else {
                        self.askEncryptionModalHLM._showDeferred.reject();
                    }
                    self.askEncryptionModalHLM.stackableScope.values = {};

                    if(angular.isDefined(self.broadcastResetInputFunction)) {
                        self.broadcastResetInputFunction();
                    }
                }
            }
        };

        this.addComputeNodeModalHLM = {
            _show: false,
            show: function () {
                if (self.askEncryptionModalHLM._show) {
                    return $q.reject('Singleton pattern for add compute host');
                }

                self.addComputeNodeModalHLM._show = true;
                self.addComputeNodeModalHLM._showDeferred = $q.defer();
                return self.addComputeNodeModalHLM._showDeferred.promise;
            },
            stackableScope: {
                values: {},
                selections: {
                    nicMappings: [],
                    groups: []
                },
                options: {
                    encryptionRequired: false
                },
                cancel: function () {
                    self.addComputeNodeModalHLM._show = false;
                    self.addComputeNodeModalHLM.stackableScope.values = {};

                    if(angular.isDefined(self.broadcastResetInputFunction)) {
                        self.broadcastResetInputFunction();
                    }
                    self.addComputeNodeModalHLM._showDeferred.reject();
                },
                add: function () {
                    self.addComputeNodeModalHLM._show = false;
                    self.addComputeNodeModalHLM._showDeferred
                        .resolve(self.addComputeNodeModalHLM.stackableScope.values);
                },
                validateServer: function (serverId) {
                    serverId = serverId.toLowerCase();
                    return _.filter(
                        self.addComputeNodeModalHLM.stackableScope.selections.servers,
                        function (value) {
                            return value.toLowerCase() === serverId;
                        }).length === 0;
                }
            }
        };

        this.addCompute_HLM = function() {
            self.addHostValues = {};
            self.addHostServer = {};
            self.addComputeNodeModalHLM.stackableScope.values = {};

            // Fetch the latest model, this will contain server roles, server groups and nic-mapping options
            ArdanaService.getModel()
                .catch(function (error) {
                    addNotification(
                        "error",
                        $translate.instant(
                            "compute.compute_nodes.hlm.add.notification.fetch_model_failed",
                            {'details': error.data ? error.data[0].data : ''}
                        )
                    );
                    throw error;
                })
                // Process model to discover server roles, etc
                .then(function (model) {

                    var scope = self.addComputeNodeModalHLM.stackableScope;

                    // Create the collection to populate select form inputs
                    scope.selections = {};

                    // ... Server roles. Only compute roles are valid (roles that contain nova-client)
                    scope.selections.roles = ArdanaService.findComputeRoles(model);

                    // ... Server Groups. Discover the leaf server groups and their group breadcrumb
                    scope.selections.groups = ArdanaService.findLeafServerGroups(model);

                    // ... NIC Mappings
                    scope.selections.nicMappings =
                        _.map(model.inputModel["nic-mappings"], function (option) {
                            return {
                                label: option.name,
                                value: option.name
                            };
                        });

                    //Current Servers
                    scope.selections.servers = _.map(model.inputModel.servers, "id");

                    scope.options.encryptionRequired = ArdanaService.isConfigEncrypted();

                    // Create the initial values for the modal, either from previous entries or default
                    function defaultSelectOption(valueName, groupsName) {
                        return _.get(scope.values[valueName], 'value') ||
                            (scope.selections[groupsName][0] || {value: ''}).value;
                    }

                    scope.values = {
                        id: scope.values.id || '',
                        role: defaultSelectOption('role', 'roles'),
                        group: defaultSelectOption('group', 'groups'),
                        nicMapping: defaultSelectOption('nicMapping', 'nicMappings'),
                        ip: scope.values.ip || '',
                        encryptionKey: scope.values.encryptionKey || ''
                    };

                    getRegions().then(function(regions) {
                        if(angular.isDefined(regions) && regions.length > 0) {
                            scope.selections.regions =
                                regions.map(function(datum) {
                                    return {
                                        label: datum.id,
                                        value: datum.id
                                    };
                                });
                            scope.values.region = defaultSelectOption('region', 'regions');
                        }

                        if(angular.isDefined(self.broadcastResetInputFunction)) {
                            self.broadcastResetInputFunction();
                        }

                    });

                })
                // Show the add compute host slideout
                .then(_.partial(self.addComputeNodeModalHLM.show))
                // Create the HLM server object
                .then(function (values) {
                    self.addHostValues = values;
                    // Create server with mandatory fields
                    self.addHostServer = {
                        'id': values.id,
                        'ip-addr': values.ip,
                        'role': values.role
                    };
                    // Conditionally add optional fields
                    if (values.group && values.group.length > 0) {
                        self.addHostServer["server-group"] = values.group;
                    }
                    if (values.nicMapping && values.nicMapping.length > 0) {
                        self.addHostServer["nic-mapping"] = values.nicMapping;
                    }
                    if (values.region && values.region.length > 0) {
                        self.addHostServer.region = values.region;
                    }
                    self.showConfirmAddModalFlag = true;
                });

        };

        this.commitAddHost_HLM = function()  {
            self.updatingHostOverlayFlag = true;
            //will be used to block actions as singleton value
            self.blockActionFlag = false;

            ArdanaService.addServer(self.addHostServer, self.addHostValues.encryptionKey, true)
                .then(function (data) {
                    // Successfully submitted (model changed, validation passed, ready deploy ran,
                    // deploy started).
                    var pRef = _.get(data.data, 'pRef');
                    addNotification(
                        "info",
                        $translate.instant(
                            "compute.compute_nodes.hlm.add.notification.deploy_started",
                            {'name': self.addHostServer.id, 'processId': pRef}
                        )
                    );
                    //wnen adding compute host is in progress
                    //just block all the actions
                    //close the comfirm dialog
                    self.blockActionFlag = true;
                    self.showConfirmAddModalFlag = false;
                    self.updatingHostOverlayFlag = false;

                    ArdanaService.poll(pRef, '')
                        .then(function () {
                            addNotification(
                                "info",
                                $translate.instant(
                                    "compute.compute_nodes.hlm.add.notification.success",
                                    {name: self.addHostValues.id}
                                )
                            );
                            self.addHostValues = {};

                            // Successfully added host, give some time for nova to update and refresh
                            //when it is done just wait a little and refresh it
                            //add compute host for HLM only in compute host table page
                            if(angular.isDefined(self.refreshTableFunction)) {
                                $timeout( function() {
                                    self.refreshTableFunction();
                                    self.blockActionFlag = false;
                                }, 20 * 1000);
                            }
                            else {
                                self.blockActionFlag = false;
                            }
                        })
                        .catch(function (data) {
                            var code = _.get(data.data, 'code', -1);
                            if (code > 0) {
                                // Deploy failed
                                self.logViewHLM.addCustomNotification(
                                    "error",
                                    $translate.instant(
                                        "compute.compute_nodes.hlm.add.notification.deploy_failed",
                                        {name: self.addHostValues.id}),
                                    data
                                );
                            } else {
                                // Poll failed
                                addNotification("error",
                                    $translate.instant(
                                        "compute.compute_nodes.hlm.add.notification.poll_failed",
                                        {name: self.addHostValues.id}));
                            }
                            self.blockActionFlag = false;
                        });
                })
                .catch(function (error) {
                    // Failed to submit (one of model changed, validation or ready deploy failed)
                    var errorNotification;
                    var errorCode = _.get(error, 'data.errorCode');
                    if (errorCode) {
                        errorNotification = $translate.instant(
                            "compute.compute_nodes.hlm.add.notification.error", {
                                name: self.addHostServer.id,
                                details: $translate.instant("compute.compute_nodes.hlm.errors." + errorCode)
                            });
                    } else {
                        errorNotification = $translate.instant(
                            "compute.compute_nodes.hlm.add.notification.error", {
                                'name': self.addHostServer.id,
                                'details': error.data ? error.data[0].data : ''
                            });
                    }

                    self.logViewHLM.addCustomNotification("error", errorNotification, error);
                    self.showConfirmAddModalFlag = false;
                    self.updatingHostOverlayFlag = false;
                }
            );
        };

        this.activateCompute_HLM = function(data) {
            self.encryptionKey = '';
            self.hlmConfirmData = {};

            self.askEncryptionModalHLM.show()
            .then(function (key) {
                self.encryptionKey = key;
            })
            .then(function () {
                self.showConfirmActivateModalFlag = true;
                self.hlmConfirmData = data;
            });
        };

        this.commitActivateHost_HLM = function() {
            var progress_count = 0;

            if(!angular.isDefined(self.hlmConfirmData)) {
                self.showConfirmActivateModalFlag = false;
                return;
            }

            var originState = self.hlmConfirmData.state;
            self.updatingHostOverlayFlag = true;

            var activateNode = {
                'id': self.hlmConfirmData.id,
                'name': self.hlmConfirmData.name
            };
            if(angular.isDefined(self.hlmConfirmData.region)) {
                activateNode.region = self.hlmConfirmData.region;
            }
            ArdanaService.activate(activateNode, self.encryptionKey).then(
                function () {
                    addNotification("info",
                        $translate.instant(
                            "compute.activate_compute.messages.activate.success",
                            {'name': activateNode.name})
                    );
                    //work around to deal with state
                    //when it is done just wait a little and refresh it
                    if(angular.isDefined(self.refreshTableFunction)) {
                        $timeout(function () {
                            self.refreshTableFunction(true);
                            self.showConfirmActivateModalFlag = false;
                            self.updatingHostOverlayFlag = false;
                        }, 20 * 1000);
                    }
                    else {
                        //update the state in detail page
                        $timeout(function() {
                            if(angular.isDefined(self.closeDetailModalFunction)){
                                self.closeDetailModalFunction();
                            }
                            //detail drill down from another page
                            //need to refresh that page
                            if(angular.isDefined(self.refreshSummaryFunction)){
                                self.refreshSummaryFunction();
                            }

                            self.showConfirmActivateModalFlag = false;
                            self.updatingHostOverlayFlag = false;
                        }, 20 * 1000);
                    }
                },
                function (error) {
                    var errorNotification;
                    var errorCode = _.get(error, 'data.errorCode');
                    if (errorCode) {
                        errorNotification = $translate.instant(
                            "compute.activate_compute.messages.activate.error", {
                                name: activateNode.name,
                                details: $translate.instant("compute.compute_nodes.hlm.errors." + errorCode)
                            });
                    } else {
                        errorNotification = $translate.instant(
                            "compute.activate_compute.messages.activate.error",
                            {'name': activateNode.name, 'details': error.data ? error.data[0].data : ''}
                        );
                    }
                    self.logViewHLM.addCustomNotification("error", errorNotification, error);

                    log('error', 'Failed to activate compute host ' + activateNode.name);
                    log('error', JSON.stringify(error));
                     //refresh it to change the state when temp set during
                    //progress
                    //refresh table
                    if(angular.isDefined(self.refreshTableFunction)) {
                        self.refreshTableFunction(true);
                    }
                    else { //close detail page and restore the state
                        if(angular.isDefined(self.closeDetailModalFunction)){
                            self.closeDetailModalFunction();
                        }
                        if(angular.isDefined(self.setProgressStateFunction)) {
                            self.setProgressStateFunction(activateNode.id, originState);
                        }
                    }
                    self.showConfirmActivateModalFlag = false;
                    self.updatingHostOverlayFlag = false;
                },
                function (progress_data) {
                    if (progress_data) {
                        var id = progress_data.id;
                        log('info', 'Activation in progress for compute host ' + activateNode.name + ' state=' + progress_data.state);
                        //hlm doesn't update the transition state, have to set it during progress
                        //however if user refresh table, the state will be gone
                        //only set the transition state once here...here is 'activating'
                        if(angular.isDefined(self.setProgressStateFunction) && progress_count === 0) {
                            self.setProgressStateFunction(activateNode.id, progress_data.state );
                            progress_count++;
                        }
                    }
                }
            );
        };

        this.deactivateCompute_HLM = function(data) {
            self.encryptionKey = '';
            self.hlmConfirmData = {};
            //ask user to enter encryption key if the system is encrypted
            self.askEncryptionModalHLM.show()
            .then(function (key) {
                self.encryptionKey = key;
            })
            .then ( function() {
                self.showConfirmDeactivateModalFlag = true;
                self.hlmConfirmData = data;
            });
        };

        this.commitDeactivateHost_HLM = function() {
            var progress_count = 0;

            if(!angular.isDefined(self.hlmConfirmData)) {
                self.showConfirmDeactivateModalFlag = false;
                return;
            }

            var originState = self.hlmConfirmData.state;
            self.updatingHostOverlayFlag = true;

            var deactivateNode = {
                'id': self.hlmConfirmData.id,
                'name': self.hlmConfirmData.name
            };
            if(angular.isDefined(self.hlmConfirmData.region)) {
                deactivateNode.region = self.hlmConfirmData.region;
            }
            ArdanaService.deactivate(deactivateNode, self.encryptionKey).then(
                function () {
                    addNotification(
                        "info",
                          $translate.instant(
                              "compute.deactivate_compute.messages.deactivate.success",
                              {'name': deactivateNode.name}));
                    //when it is done just wait a little and refresh it
                    //however sometimes it goes slow even wait 50 seconds, the table
                    //still shows old state
                    if(angular.isDefined(self.refreshTableFunction)) {
                        $timeout(function() {
                            self.refreshTableFunction(true);
                            self.showConfirmDeactivateModalFlag = false;
                            self.updatingHostOverlayFlag = false;
                        }, 60 * 1000);
                    }
                    else {
                        //close detail modal
                        //refresh summary page
                        $timeout(function() {
                            if(angular.isDefined(self.closeDetailModalFunction)){
                                self.closeDetailModalFunction();
                            }
                            //detail drill down from another page
                            //need to refresh that page
                            if(angular.isDefined(self.refreshSummaryFunction)){
                                self.refreshSummaryFunction();
                            }
                            self.updatingHostOverlayFlag = false;
                            self.showConfirmDeactivateModalFlag = false;
                        }, 60 * 1000);
                    }
                },
                function (error) {
                    var errorNotification;
                    var errorCode = _.get(error, 'data.errorCode');
                    if (errorCode) {
                        errorNotification = $translate.instant(
                            "compute.deactivate_compute.messages.deactivate.error", {
                                name: deactivateNode.name,
                                details: $translate.instant("compute.compute_nodes.hlm.errors." + errorCode)
                            });
                    } else {
                        errorNotification = $translate.instant(
                            "compute.deactivate_compute.messages.deactivate.error",
                            {'name': deactivateNode.name, 'details': error.data ? error.data[0].data : '' }
                        );
                    }

                    self.logViewHLM.addCustomNotification("error", errorNotification, error);

                    log('error', 'Failed to deactivate compute host ' + deactivateNode.name);
                    log('error', JSON.stringify(error));
                    //refresh it to change the state when temp set during
                    //progress
                    //refresh table
                    if(angular.isDefined(self.refreshTableFunction)) {
                        self.refreshTableFunction(true);
                    }
                    else { //close detail page and restore the state
                        if(angular.isDefined(self.closeDetailModalFunction)){
                            self.closeDetailModalFunction();
                        }
                        if(angular.isDefined(self.setProgressStateFunction)) {
                            self.setProgressStateFunction(deactivateNode.id, originState);
                        }
                    }
                    self.showConfirmDeactivateModalFlag = false;
                    self.updatingHostOverlayFlag = false;
                },
                function (progress_data) {
                    if (progress_data) {
                        log('info', 'Deactivation in progress for compute host ' +
                             deactivateNode.name + ' state=' + progress_data.state);
                        //see the corresponding comments in commitActivateHost_HLM
                        if(angular.isDefined(self.setProgressStateFunction) && progress_count === 0) {
                            self.setProgressStateFunction(deactivateNode.id, progress_data.state );
                            progress_count++;
                        }
                    }
                }
            );
        };

        this.deleteCompute_HLM = function(data) {
            self.encryptionKey = '';
            self.hlmConfirmData = {};
            self.hlmServerInfo = '';
            //get the server_info.yml
            ArdanaService.getServerInfo()
                .then(function(serverInfo) {
                    self.hlmServerInfo = serverInfo;
                    self.askEncryptionModalHLM.show()
                    .then(function (key) {
                        self.encryptionKey = key;
                    })
                    .then(function () {
                        self.showConfirmDeleteModalFlag = true;
                        self.hlmConfirmData = data;
                    });
                })
                .catch(function (error) {
                    if(angular.isDefined(error)) {
                        var errMsg1 = $translate.instant(
                            "compute.compute_nodes.hlm.delete.serverinfo.error", {
                                'name': data.name,
                                'details': error.data ? error.data[0].data : ''
                            }
                        );
                        addNotification("error",errMsg1);
                        log('error', JSON.stringify(error));
                    }
                    else { //have nod data;
                        var errMsg = $translate.instant(
                            "compute.compute_nodes.hlm.delete.serverinfo.empty", {
                                'name': data.name
                            }
                        );
                        addNotification("error", errMsg);
                    }

                    //only close modal when the deletion invoked from summary page
                    if(!angular.isDefined(self.refreshTableFunction)) {
                        if(angular.isDefined(self.closeDetailModalFunction)){
                            self.closeDetailModalFunction();
                        }
                    }
                }
            );
        };

        this.commitDeleteHost_HLM = function() {

            var progress_count = 0;

            if(!angular.isDefined(self.hlmConfirmData)) {
                self.showConfirmDeleteModalFlag = false;
                return;
            }

            var deleteNode = {
                'id': self.hlmConfirmData.id,
                'name': self.hlmConfirmData.name
            };
            if(angular.isDefined(self.hlmConfirmData.region)) {
                deleteNode.region = self.hlmConfirmData.region;
            }

            var originState = self.hlmConfirmData.state;
            self.updatingHostOverlayFlag = true;

            //just want to find out the compute host to delete exists
            //get id to call hlm process later
            var hlmServer;
            angular.forEach(self.hlmServerInfo, function(value, key) {
                if(angular.isDefined(value.hostname) &&
                    value.hostname === deleteNode.name) {
                    hlmServer = {
                        'id': key, 'value': self.hlmServerInfo[key]
                    };
                }
            });

            if (!hlmServer) {
                addNotification(
                    "error",
                    $translate.instant(
                        "compute.compute_nodes.hlm.delete.notification.determine_hlm_id",
                        {hostname: deleteNode.name}
                    )
                );
                //only close modal when the deletion invoked from summary page
                if(!angular.isDefined(self.refreshTableFunction)) {
                    if(angular.isDefined(self.closeDetailModalFunction)){
                        self.closeDetailModalFunction();
                    }
                }
                self.showConfirmDeleteModalFlag = false;
                self.updatingHostOverlayFlag = false;
                return;
            }

            ArdanaService.delete(deleteNode, hlmServer, self.encryptionKey).then(
                function () {
                    addNotification("info",
                        $translate.instant(
                            "compute.compute_nodes.hlm.delete.notification.success",
                            {'name': deleteNode.name})
                    );
                    //when it is done just wait a little and refresh it
                    if(angular.isDefined(self.refreshTableFunction)) {
                        $timeout(function() {
                            self.refreshTableFunction(true);
                            self.showConfirmDeleteModalFlag = false;
                            self.updatingHostOverlayFlag = false;
                        }, 20 * 1000);
                    }
                    else {
                        $timeout(function(){
                            if(angular.isDefined(self.closeDetailModalFunction)){
                                self.closeDetailModalFunction();
                            }
                            //detail drill down from another page
                            //need to refresh that page
                            if(angular.isDefined(self.refreshSummaryFunction)){
                                self.refreshSummaryFunction();
                            }
                            self.showConfirmDeleteModalFlag = false;
                            self.updatingHostOverlayFlag = false;
                        }, 20 * 1000);
                    }
                },
                function (error) {
                    var errorNotification;
                    var errorCode = _.get(error, 'data.errorCode');
                    if (errorCode) {
                        errorNotification = $translate.instant(
                            "compute.compute_nodes.hlm.delete.notification.error", {
                                name: deleteNode.name,
                                details: $translate.instant("compute.compute_nodes.hlm.errors." + errorCode)
                            });
                    } else {
                        errorNotification = $translate.instant(
                            "compute.compute_nodes.hlm.delete.notification.error",
                            {'name': deleteNode.name, 'details': error.data ? error.data[0].data : ''}
                        );
                    }

                    log('error', 'Failed to delete compute host ' + deleteNode.name);
                    log('error', JSON.stringify(error));

                    self.logViewHLM.addCustomNotification("error", errorNotification, error);

                    //refresh it to change the state when temp set during
                    //progress
                    //refresh table
                    if(angular.isDefined(self.refreshTableFunction)) {
                        self.refreshTableFunction(true);
                    }
                    else { //close detail page and restore the state
                        if(angular.isDefined(self.closeDetailModalFunction)){
                            self.closeDetailModalFunction();
                        }
                        if(angular.isDefined(self.setProgressStateFunction)) {
                            self.setProgressStateFunction(deleteNode.id, originState);
                        }
                    }

                    self.showConfirmDeleteModalFlag = false;
                    self.updatingHostOverlayFlag = false;
                },
                function (progress_data) { //don't see there is progress response, leave it here for now
                    if (progress_data) {
                        log('info', 'Deletion in progress for compute host ' + deleteNode.name + ' state=' + progress_data.state);
                        //see the corresponding comments in commitActivateHost_HLM
                        if(angular.isDefined(self.setProgressStateFunction) && progress_count === 0) {
                            self.setProgressStateFunction(deleteNode.id, progress_data.state );
                            progress_count++;
                        }
                    }
                }
            );
        };

        this.logViewHLM = {
            show: false,
            stackableScope: {
                pRef: undefined,
                log: undefined
            },
            //template: "compute/templates/hlm/log_view.html",
            colouriser: AnsiColoursService.getInstance(),
            addCustomNotification: function (level, message, error) {
                // The error object may come from a failed request or the response to a metadata request
                var action, pRef, log;
                if (error) {
                    pRef = _.get(error, "data.error.pRef") || _.get(error, "data.pRef");
                    log = _.get(error, "data.error.log") || _.get(error, "data.log");
                }

                // Only added the action obj if we have something to link to
                if (pRef || log) {
                    action = {
                        label: "compute.compute_nodes.hlm.notification.action.label",
                        func: self.logViewHLM.showLog,
                        param: {
                            pRef: pRef,
                            log: log
                        }
                    };
                }
                addNotification(level, message, action);
            },
            showLog: function (opts) {
                var log = opts.log;
                if (log) {
                    // Already have a log, show it straight away
                    self.logViewHLM.stackableScope.log =
                        self.logViewHLM.colouriser.ansiColoursToHtml(log);
                } else if (opts.pRef) {
                    // No log, show 'fetching' message and reach out to the backend
                    self.logViewHLM.stackableScope.log = $translate.instant(
                        "compute.compute_nodes.hlm.logView.fetching");
                    ArdanaService.getLog(opts.pRef).
                    then(function (logData) {
                    self.logViewHLM.stackableScope.log =
                        self.logViewHLM.colouriser.ansiColoursToHtml(logData.data.log);
                    })
                    .catch(function () {
                        self.logViewHLM.stackableScope.log = $translate.instant(
                            "compute.compute_nodes.hlm.logView.failedToFetch");
                    });
                } else {
                    // No log, no process reference
                    self.logViewHLM.stackableScope.log = $translate.instant(
                        "compute.compute_nodes.hlm.logView.noLogDetails");
                }

                self.logViewHLM.show = true;
            }
        };

        //global variables could be exposed to controller or directive
        //HLM
        this.initService = function(callbacks) {
            self.hlmConfirmData = {};
            self.encryptionKey = '';
            self.hlmServerInfo = '';
            self.showConfirmDeactivateModalFlag = false;
            self.showConfirmActivateModalFlag = false;
            self.showConfirmDeleteModalFlag = false;
            self.showConfirmAddModalFlag = false;

            //init ask encryption modal
            self.askEncryptionModalHLM._show = false;
            self.askEncryptionModalHLM.stackableScope.values = {};

            //init add modal
            self.addComputeNodeModalHLM._show = false;
            self.addComputeNodeModalHLM.stackableScope.values = {};
            self.addComputeNodeModalHLM.stackableScope.selections = {
                nicMappings: [],
                groups: []
            };

            //init logview
            self.logViewHLM.show = false;
            self.logViewHLM.stackableScope = {
                pRef: undefined,
                log: undefined
            };

            //use it to block user actions when compute host in
            //transition state
            self.updatingHostOverlayFlag = false;

            //call back functions
            self.refreshTableFunction = undefined;
            self.broadcastResetInputFunction = undefined;
            self.setProgressStateFunction = undefined;
            self.closeDetailModalFunction = undefined;
            self.refreshSummaryFunction = undefined;

            if (!angular.isDefined(callbacks)) {
                return;
            }

            if(angular.isDefined(callbacks.refreshTableFunc)) {
                self.refreshTableFunction = callbacks.refreshTableFunc;
            }

            if(angular.isDefined(callbacks.broadcastResetInputFunc)) {
                self.broadcastResetInputFunction = callbacks.broadcastResetInputFunc;
            }

            if(angular.isDefined(callbacks.setProgressStateFunc)) {
                self.setProgressStateFunction = callbacks.setProgressStateFunc;
            }

            if(angular.isDefined(callbacks.closeDetailModalFunc)) {
                self.closeDetailModalFunction = callbacks.closeDetailModalFunc;
            }

            if(angular.isDefined(callbacks.refreshSummaryFunc)) {
                self.refreshSummaryFunction = callbacks.refreshSummaryFunc;
            }
        };
    }]);
})(angular);
