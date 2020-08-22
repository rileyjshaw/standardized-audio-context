import { NODE_NAME_TO_PROCESSOR_CONSTRUCTOR_MAPS } from '../globals';
import { isConstructible } from '../helpers/is-constructible';
import { splitImportStatements } from '../helpers/split-import-statements';
import { IAudioWorkletProcessorConstructor } from '../interfaces';
import { TAddAudioWorkletModuleFactory, TEvaluateAudioWorkletGlobalScopeFunction } from '../types';

const verifyParameterDescriptors = (parameterDescriptors: IAudioWorkletProcessorConstructor['parameterDescriptors']) => {
    if (parameterDescriptors !== undefined && !Array.isArray(parameterDescriptors)) {
        throw new TypeError('The parameterDescriptors property of given value for processorCtor is not an array.');
    }
};

const verifyProcessorCtor = <T extends IAudioWorkletProcessorConstructor>(processorCtor: T) => {
    if (!isConstructible(processorCtor)) {
        throw new TypeError('The given value for processorCtor should be a constructor.');
    }

    if (processorCtor.prototype === null || typeof processorCtor.prototype !== 'object') {
        throw new TypeError('The given value for processorCtor should have a prototype.');
    }
};

export const createAddAudioWorkletModule: TAddAudioWorkletModuleFactory = (
    cacheTestResult,
    createNotSupportedError,
    evaluateSource,
    exposeCurrentFrameAndCurrentTime,
    fetchSource,
    getBackupNativeContext,
    getNativeContext,
    ongoingRequests,
    resolvedRequests,
    testAudioWorkletProcessorPostMessageSupport,
    window
) => {
    return (context, moduleURL, options = { credentials: 'omit' }) => {
        const nativeContext = getNativeContext(context);
        const absoluteUrl = new URL(moduleURL, window.location.href).toString();

        // Bug #59: Only Chrome & Opera do implement the audioWorklet property.
        if (nativeContext.audioWorklet !== undefined) {
            return Promise.all([
                fetchSource(moduleURL),
                Promise.resolve(cacheTestResult(testAudioWorkletProcessorPostMessageSupport, testAudioWorkletProcessorPostMessageSupport))
            ]).then(([source, isSupportingPostMessage]) => {
                const [importStatements, sourceWithoutImportStatements] = splitImportStatements(source, absoluteUrl);
                /*
                 * Bug #179: Firefox does not allow to transfer any buffer which has been passed to the process() method as an argument.
                 *
                 * This is the unminified version of the code used below.
                 *
                 * ```js
                 * class extends AudioWorkletProcessor {
                 *
                 *     __buffers = new WeakSet();
                 *
                 *     constructor () {
                 *         super();
                 *
                 *         this.port.postMessage = ((postMessage) => {
                 *             return (message, transferables) => {
                 *                 const filteredTransferables = (transferables)
                 *                     ? transferables.filter((transferable) => !this.__buffers.has(transferable))
                 *                     : transferables;
                 *
                 *                 return postMessage.call(this.port, message, filteredTransferables);
                 *              };
                 *         })(this.port.postMessage);
                 *     }
                 * }
                 * ```
                 */
                const patchedSourceWithoutImportStatements = isSupportingPostMessage
                    ? sourceWithoutImportStatements
                    : sourceWithoutImportStatements.replace(
                          /\s+extends\s+AudioWorkletProcessor\s+/,
                          ` extends (class extends AudioWorkletProcessor {__b=new WeakSet();constructor(){super();(p=>p.postMessage=(q=>(m,t)=>q.call(p,m,t?t.filter(u=>!this.__b.has(u)):t))(p.postMessage))(this.port)}}) `
                      );
                /*
                 * Bug #170: Chrome does call process() with an array with empty channelData for each input if no input is connected.
                 *
                 * Bug #179: Firefox does not allow to transfer any buffer which has been passed to the process() method as an argument.
                 *
                 * This is the unminified version of the code used below:
                 *
                 * ```js
                 * `${ importStatements };
                 * ((registerProcessor) => {${ sourceWithoutImportStatements }
                 * })((name, processorCtor) => registerProcessor(name, class extends processorCtor {
                 *
                 *     __collectBuffers = (array) => {
                 *         array.forEach((element) => this.__buffers.add(element.buffer));
                 *     };
                 *
                 *     process (inputs, outputs, parameters) {
                 *         inputs.forEach(this.__collectBuffers);
                 *         outputs.forEach(this.__collectBuffers);
                 *         this.__collectBuffers(Object.values(parameters));

                 *         return super.process(
                 *             (inputs.map((input) => input.some((channelData) => channelData.length === 0)) ? [ ] : input),
                 *             outputs,
                 *             parameters
                 *         );
                 *     }
                 *
                 * }))`
                 * ```
                 */
                const memberDefinition = isSupportingPostMessage ? '' : '__c = (a) => a.forEach(e=>this.__b.add(e.buffer));';
                const bufferRegistration = isSupportingPostMessage
                    ? ''
                    : 'i.forEach(this.__c);o.forEach(this.__c);this.__c(Object.values(p));';
                const wrappedSource = `${importStatements};(registerProcessor=>{${patchedSourceWithoutImportStatements}
})((n,p)=>registerProcessor(n,class extends p{${memberDefinition}process(i,o,p){${bufferRegistration}return super.process(i.map(j=>j.some(k=>k.length===0)?[]:j),o,p)}}))`;
                const blob = new Blob([wrappedSource], { type: 'application/javascript; charset=utf-8' });
                const url = URL.createObjectURL(blob);

                const backupNativeContext = getBackupNativeContext(nativeContext);
                const nativeContextOrBackupNativeContext = backupNativeContext !== null ? backupNativeContext : nativeContext;

                return nativeContextOrBackupNativeContext.audioWorklet
                    .addModule(url, options)
                    .catch((err) => {
                        if (err.code === undefined || err.name === 'SyntaxError') {
                            err.code = 12;
                        }

                        throw err;
                    })
                    .finally(() => URL.revokeObjectURL(url));
            });
        }

        const resolvedRequestsOfContext = resolvedRequests.get(context);

        if (resolvedRequestsOfContext !== undefined && resolvedRequestsOfContext.has(moduleURL)) {
            return Promise.resolve();
        }

        const ongoingRequestsOfContext = ongoingRequests.get(context);

        if (ongoingRequestsOfContext !== undefined) {
            const promiseOfOngoingRequest = ongoingRequestsOfContext.get(moduleURL);

            if (promiseOfOngoingRequest !== undefined) {
                return promiseOfOngoingRequest;
            }
        }

        const promise = fetchSource(moduleURL)
            .then((source) => {
                const [importStatements, sourceWithoutImportStatements] = splitImportStatements(source, absoluteUrl);

                /*
                 * This is the unminified version of the code used below:
                 *
                 * ```js
                 * ${ importStatements };
                 * ((a, b) => {
                 *     (a[b] = a[b] || [ ]).push(
                 *         (AudioWorkletProcessor, global, registerProcessor, sampleRate, self, window) => {
                 *             ${ sourceWithoutImportStatements }
                 *         }
                 *     );
                 * })(window, '_AWGS');
                 * ```
                 */
                // tslint:disable-next-line:max-line-length
                const wrappedSource = `${importStatements};((a,b)=>{(a[b]=a[b]||[]).push((AudioWorkletProcessor,global,registerProcessor,sampleRate,self,window)=>{${sourceWithoutImportStatements}
})})(window,'_AWGS')`;

                // @todo Evaluating the given source code is a possible security problem.
                return evaluateSource(wrappedSource);
            })
            .then(() => {
                const evaluateAudioWorkletGlobalScope = (<TEvaluateAudioWorkletGlobalScopeFunction[]>(<any>window)._AWGS).pop();

                if (evaluateAudioWorkletGlobalScope === undefined) {
                    throw new SyntaxError();
                }

                exposeCurrentFrameAndCurrentTime(nativeContext.currentTime, nativeContext.sampleRate, () =>
                    evaluateAudioWorkletGlobalScope(
                        class AudioWorkletProcessor {},
                        undefined,
                        (name, processorCtor) => {
                            if (name.trim() === '') {
                                throw createNotSupportedError();
                            }

                            const nodeNameToProcessorConstructorMap = NODE_NAME_TO_PROCESSOR_CONSTRUCTOR_MAPS.get(nativeContext);

                            if (nodeNameToProcessorConstructorMap !== undefined) {
                                if (nodeNameToProcessorConstructorMap.has(name)) {
                                    throw createNotSupportedError();
                                }

                                verifyProcessorCtor(processorCtor);
                                verifyParameterDescriptors(processorCtor.parameterDescriptors);

                                nodeNameToProcessorConstructorMap.set(name, processorCtor);
                            } else {
                                verifyProcessorCtor(processorCtor);
                                verifyParameterDescriptors(processorCtor.parameterDescriptors);

                                NODE_NAME_TO_PROCESSOR_CONSTRUCTOR_MAPS.set(nativeContext, new Map([[name, processorCtor]]));
                            }
                        },
                        nativeContext.sampleRate,
                        undefined,
                        undefined
                    )
                );
            })
            .catch((err) => {
                if (err.code === undefined || err.name === 'SyntaxError') {
                    err.code = 12;
                }

                throw err;
            });

        if (ongoingRequestsOfContext === undefined) {
            ongoingRequests.set(context, new Map([[moduleURL, promise]]));
        } else {
            ongoingRequestsOfContext.set(moduleURL, promise);
        }

        promise
            .then(() => {
                const rslvdRqstsFCntxt = resolvedRequests.get(context);

                if (rslvdRqstsFCntxt === undefined) {
                    resolvedRequests.set(context, new Set([moduleURL]));
                } else {
                    rslvdRqstsFCntxt.add(moduleURL);
                }
            })
            .finally(() => {
                const ngngRqstsFCntxt = ongoingRequests.get(context);

                if (ngngRqstsFCntxt !== undefined) {
                    ngngRqstsFCntxt.delete(moduleURL);
                }
            });

        return promise;
    };
};
