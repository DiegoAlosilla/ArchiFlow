/**
 * ArchiFlow extension for the self-hosted diagrams.net editor.
 *
 * Records architecture flows by clicking vertices, resolves connectors
 * automatically and persists technical request/response metadata in the
 * current page's mxGraphModel root.
 */
Draw.loadPlugin(function(ui)
{
    'use strict';

    if (ui.editor.isChromelessView())
    {
        return;
    }

    var graph = ui.editor.graph;
    var model = graph.getModel();
    var STORE_ATTRIBUTE = 'archiflowFlows';
    var STEP_DELAY = 150;
    var PARTICLE_SPEED = 190;
    var PARTICLE_TRAIL_GAP = 12;
    var store = null;
    var selectedStep = 0;
    var recording = false;
    var recordingMode = 'new';
    var playing = false;
    var exportingGif = false;
    var playTimer = null;
    var playbackPhase = 'request';
    var particleFrame = null;
    var particles = [];
    var badges = [];
    var panelMode = 'contract';
    var selectedContractCellId = null;
    var flowHistory = {};

    function uid(prefix)
    {
        return prefix + '-' + Math.random().toString(36).substring(2, 9);
    }

    function emptyStep(cellId, edgeId, responseEdgeId)
    {
        return {
            id: uid('step'),
            cellId: cellId,
            edgeId: edgeId || null,
            responseEdgeId: responseEdgeId || null,
            operation: '',
            protocol: 'HTTP',
            purpose: '',
            queryParams: '',
            pathParams: '',
            requestHeaders: '',
            requestBody: '',
            responseStatus: '',
            responseHeaders: '',
            responseBody: '',
            cacheOperation: '',
            cacheKey: '',
            cacheData: '',
            cacheTtl: '',
            notes: ''
        };
    }

    function emptyStore()
    {
        var flow = { id: uid('flow'), name: 'Nuevo flujo', steps: [] };
        return { version: 2, activeFlowId: flow.id, flows: [flow], activeContractId: null, contracts: [] };
    }

    function normalizeStore()
    {
        store.version = 2;
        store.contracts = Array.isArray(store.contracts) ? store.contracts : [];
        store.activeContractId = store.activeContractId || null;

        if (store.contracts.length === 0)
        {
            for (var cellId in model.cells)
            {
                if (!Object.prototype.hasOwnProperty.call(model.cells, cellId)) continue;
                var legacyCell = model.cells[cellId];
                var legacyRaw = legacyCell != null ? graph.getAttributeForCell(legacyCell, 'archiflowOpenApi', null) : null;

                if (legacyRaw == null) continue;

                try
                {
                    var legacyContract = JSON.parse(legacyRaw);
                    var legacyInfo = legacyContract.info || {};
                    var legacyId = 'contract-legacy-' + legacyCell.id;
                    store.contracts.push({
                        id: legacyId,
                        name: legacyInfo.title || labelFor(legacyCell),
                        fileName: graph.getAttributeForCell(legacyCell, 'archiflowContractFile', 'openapi'),
                        document: legacyContract
                    });
                    if (store.activeContractId == null) store.activeContractId = legacyId;
                }
                catch (ignored)
                {
                    // El contrato legado queda disponible en la figura para poder reimportarlo.
                }
            }
        }

        if (store.activeContractId == null && store.contracts.length > 0)
        {
            store.activeContractId = store.contracts[0].id;
        }
    }

    function activeFlow()
    {
        if (store == null || store.flows == null || store.flows.length === 0)
        {
            store = emptyStore();
        }

        for (var i = 0; i < store.flows.length; i++)
        {
            if (store.flows[i].id === store.activeFlowId)
            {
                return store.flows[i];
            }
        }

        store.activeFlowId = store.flows[0].id;
        return store.flows[0];
    }

    function loadStore()
    {
        var raw = graph.getAttributeForCell(model.getRoot(), STORE_ATTRIBUTE, null);

        try
        {
            store = raw != null ? JSON.parse(raw) : emptyStore();
        }
        catch (e)
        {
            store = emptyStore();
            ui.handleError(e);
        }

        normalizeStore();

        selectedStep = Math.max(0, Math.min(selectedStep, activeFlow().steps.length - 1));
    }

    function saveStore(status)
    {
        graph.setAttributeForCell(model.getRoot(), STORE_ATTRIBUTE, JSON.stringify(store));
        ui.editor.modified = true;

        if (status != null)
        {
            ui.editor.setStatus(status);
        }
    }

    function cloneSteps(steps)
    {
        return JSON.parse(JSON.stringify(steps || []));
    }

    function historyForFlow(flow)
    {
        if (flowHistory[flow.id] == null)
        {
            flowHistory[flow.id] = { past: [], future: [] };
        }

        return flowHistory[flow.id];
    }

    function snapshotFlow(flow)
    {
        return { steps: cloneSteps(flow.steps), selectedStep: selectedStep };
    }

    function rememberFlow(flow)
    {
        var history = historyForFlow(flow);
        history.past.push(snapshotFlow(flow));

        if (history.past.length > 100)
        {
            history.past.shift();
        }

        history.future = [];
    }

    function restoreFlowSnapshot(flow, snapshot)
    {
        flow.steps = cloneSteps(snapshot.steps);
        selectedStep = Math.max(0, Math.min(snapshot.selectedStep, flow.steps.length - 1));
        reconnectSteps(flow);
        saveStore('Historial de la animación actualizado');
        refreshBadges();
        render();
    }

    function undoFlowChange()
    {
        var flow = activeFlow();
        var history = historyForFlow(flow);

        if (history.past.length === 0)
        {
            toast('No hay cambios de animación para deshacer');
            return;
        }

        history.future.push(snapshotFlow(flow));
        restoreFlowSnapshot(flow, history.past.pop());
        toast('Último cambio de animación deshecho');
    }

    function redoFlowChange()
    {
        var flow = activeFlow();
        var history = historyForFlow(flow);

        if (history.future.length === 0)
        {
            toast('No hay cambios de animación para rehacer');
            return;
        }

        history.past.push(snapshotFlow(flow));
        restoreFlowSnapshot(flow, history.future.pop());
        toast('Cambio de animación recuperado');
    }

    function contractById(contractId)
    {
        var contracts = store != null && Array.isArray(store.contracts) ? store.contracts : [];

        for (var i = 0; i < contracts.length; i++)
        {
            if (contracts[i].id === contractId) return contracts[i];
        }

        return null;
    }

    function activeContract()
    {
        var contract = contractById(store != null ? store.activeContractId : null);

        if (contract == null && store != null && store.contracts.length > 0)
        {
            contract = store.contracts[0];
            store.activeContractId = contract.id;
        }

        return contract;
    }

    function selectedContractCell()
    {
        var cell = selectedContractCellId != null ? model.getCell(selectedContractCellId) : graph.getSelectionCell();
        return cell != null && model.isVertex(cell) ? cell : null;
    }

    function descriptorKey(descriptor)
    {
        return descriptor.method + ' ' + descriptor.path;
    }

    function cellBindings(cell)
    {
        if (cell == null) return [];
        var raw = graph.getAttributeForCell(cell, 'archiflowEndpointBindings', null);

        try
        {
            var parsed = raw != null ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        }
        catch (ignored)
        {
            return [];
        }
    }

    function bindingMatches(binding, contractId, descriptor)
    {
        return binding != null && binding.contractId === contractId &&
            binding.method === descriptor.method && binding.path === descriptor.path;
    }

    function isCellBoundTo(cell, contractId, descriptor)
    {
        var bindings = cellBindings(cell);

        for (var i = 0; i < bindings.length; i++)
        {
            if (bindingMatches(bindings[i], contractId, descriptor)) return true;
        }

        return false;
    }

    function bindingCount(contractId, descriptor)
    {
        var count = 0;

        for (var cellId in model.cells)
        {
            if (Object.prototype.hasOwnProperty.call(model.cells, cellId) &&
                isCellBoundTo(model.cells[cellId], contractId, descriptor)) count++;
        }

        return count;
    }

    function setCellBindings(cell, bindings)
    {
        graph.setAttributeForCell(cell, 'archiflowEndpointBindings', JSON.stringify(bindings));
        var primary = bindings.length > 0 ? bindings[0] : null;
        graph.setAttributeForCell(cell, 'archiflowContractId', primary != null ? primary.contractId : '');
        graph.setAttributeForCell(cell, 'archiflowContractEndpoint', primary != null ? '1' : '0');
        graph.setAttributeForCell(cell, 'archiflowHttpMethod', primary != null ? primary.method : '');
        graph.setAttributeForCell(cell, 'archiflowPath', primary != null ? primary.path : '');
        graph.setAttributeForCell(cell, 'archiflowOperationId', primary != null ? primary.operationId : '');
    }

    function descriptorLines(parameters, location)
    {
        var lines = [];

        for (var i = 0; i < parameters.length; i++)
        {
            if ((parameters[i].in || 'query') === location)
            {
                lines.push(parameters[i].name + '=' + schemaText(parameters[i].schema));
            }
        }

        return lines.join('\n');
    }

    function bodySchemaLines(content)
    {
        var lines = [];
        content = content || {};

        for (var type in content)
        {
            if (Object.prototype.hasOwnProperty.call(content, type))
            {
                lines.push(type + ' · ' + schemaText(content[type].schema));
            }
        }

        return lines.join('\n');
    }

    function applyContractDescriptorToStep(step, descriptor)
    {
        var operation = descriptor.operation || {};
        var parameters = operation.parameters || [];
        var responses = operation.responses || {};
        var responseStatuses = Object.keys(responses);
        step.operation = descriptor.method + ' ' + descriptor.path;
        step.protocol = 'REST';
        if (!step.purpose) step.purpose = operation.summary || operation.description || operation.operationId || '';
        if (!step.pathParams) step.pathParams = descriptorLines(parameters, 'path');
        if (!step.queryParams) step.queryParams = descriptorLines(parameters, 'query');
        if (!step.requestHeaders) step.requestHeaders = descriptorLines(parameters, 'header');
        if (!step.requestBody && operation.requestBody != null) step.requestBody = bodySchemaLines(operation.requestBody.content);
        if (!step.responseStatus && responseStatuses.length > 0) step.responseStatus = responseStatuses[0];

        if (!step.responseBody)
        {
            var responseLines = [];
            for (var i = 0; i < responseStatuses.length; i++)
            {
                var response = responses[responseStatuses[i]] || {};
                var schemas = bodySchemaLines(response.content);
                responseLines.push(responseStatuses[i] + (schemas ? ' · ' + schemas : ' · ' + (response.description || 'Respuesta')));
            }
            step.responseBody = responseLines.join('\n');
        }
    }

    function toggleEndpointBinding(contractRecord, descriptor)
    {
        var cell = selectedContractCell();

        if (cell == null)
        {
            toast('Selecciona cualquier figura del diagrama para enlazarla');
            return;
        }

        var bindings = cellBindings(cell);
        var existingIndex = -1;

        for (var i = 0; i < bindings.length; i++)
        {
            if (bindingMatches(bindings[i], contractRecord.id, descriptor)) existingIndex = i;
        }

        model.beginUpdate();
        try
        {
            if (existingIndex >= 0)
            {
                bindings.splice(existingIndex, 1);
            }
            else
            {
                bindings.push({
                    contractId: contractRecord.id,
                    method: descriptor.method,
                    path: descriptor.path,
                    operationId: descriptor.operation.operationId || descriptorKey(descriptor),
                    summary: descriptor.operation.summary || ''
                });
            }

            setCellBindings(cell, bindings);
        }
        finally
        {
            model.endUpdate();
        }

        if (existingIndex < 0)
        {
            for (var flowIndex = 0; flowIndex < store.flows.length; flowIndex++)
            {
                var steps = store.flows[flowIndex].steps || [];
                for (var stepIndex = 0; stepIndex < steps.length; stepIndex++)
                {
                    if (steps[stepIndex].cellId === cell.id) applyContractDescriptorToStep(steps[stepIndex], descriptor);
                }
            }
        }

        saveStore(existingIndex >= 0 ? 'Endpoint desenlazado' : 'Endpoint enlazado');
        render();
        toast(existingIndex >= 0 ? 'Enlace eliminado de ' + labelFor(cell) : 'Endpoint enlazado a ' + labelFor(cell));
    }

    function labelFor(cell)
    {
        if (cell == null)
        {
            return 'Objeto eliminado';
        }

        var label = graph.convertValueToString(cell) || cell.id;
        var div = document.createElement('div');
        div.innerHTML = Graph.sanitizeHtml(label);

        var breaks = div.getElementsByTagName('br');
        while (breaks.length > 0)
        {
            breaks[0].parentNode.replaceChild(document.createTextNode(' · '), breaks[0]);
        }

        return (div.textContent || div.innerText || cell.id).replace(/\s+/g, ' ').trim();
    }

    function cellFor(step)
    {
        return step != null ? model.getCell(step.cellId) : null;
    }

    function sourceCellFor(step, fallback)
    {
        return step != null && step.fromCellId != null ? model.getCell(step.fromCellId) : fallback;
    }

    function isRecordable(cell)
    {
        return cell != null && model.isVertex(cell) &&
            graph.getAttributeForCell(cell, 'archiflowSelectable', '1') !== '0';
    }

    function inferEdge(fromCell, toCell)
    {
        if (fromCell == null || toCell == null || fromCell === toCell)
        {
            return null;
        }

        var edges = graph.getEdgesBetween(fromCell, toCell, true);

        if (edges == null || edges.length === 0)
        {
            edges = graph.getEdgesBetween(fromCell, toCell, false);
        }

        if (edges != null)
        {
            for (var i = 0; i < edges.length; i++)
            {
                if (graph.isCellVisible(edges[i]))
                {
                    return edges[i];
                }
            }
        }

        var fromComponent = componentForCell(fromCell);
        var toComponent = componentForCell(toCell);

        if (fromComponent != null && toComponent != null && fromComponent !== toComponent)
        {
            edges = graph.getEdgesBetween(fromComponent, toComponent, true);
            if (edges == null || edges.length === 0)
            {
                edges = graph.getEdgesBetween(fromComponent, toComponent, false);
            }

            for (var managedIndex = 0; edges != null && managedIndex < edges.length; managedIndex++)
            {
                var managedEdge = edges[managedIndex];
                if (graph.getAttributeForCell(managedEdge, 'archiflowSourceEndpoint', '') === fromCell.id &&
                    graph.getAttributeForCell(managedEdge, 'archiflowTargetEndpoint', '') === toCell.id)
                {
                    return managedEdge;
                }
            }
        }

        return null;
    }

    function restoreCanvas()
    {
        removeParticles();
    }

    function removeParticles()
    {
        if (particleFrame != null)
        {
            window.cancelAnimationFrame(particleFrame);
            particleFrame = null;
        }

        for (var i = 0; i < particles.length; i++)
        {
            if (particles[i].parentNode != null)
            {
                particles[i].parentNode.removeChild(particles[i]);
            }
        }

        particles = [];
    }

    function routePoints(edge, fromCell)
    {
        var state = graph.view.getState(edge);

        if (state == null || state.absolutePoints == null)
        {
            return [];
        }

        var points = [];

        for (var i = 0; i < state.absolutePoints.length; i++)
        {
            var point = state.absolutePoints[i];

            if (point != null)
            {
                points.push({ x: point.x, y: point.y });
            }
        }

        if (fromCell != null && points.length > 1)
        {
            var fromState = graph.view.getState(fromCell);
            if (fromState != null)
            {
                var centerX = fromState.x + fromState.width / 2;
                var centerY = fromState.y + fromState.height / 2;
                var firstDx = points[0].x - centerX;
                var firstDy = points[0].y - centerY;
                var lastDx = points[points.length - 1].x - centerX;
                var lastDy = points[points.length - 1].y - centerY;
                if (lastDx * lastDx + lastDy * lastDy < firstDx * firstDx + firstDy * firstDy)
                {
                    points.reverse();
                }
            }
            else if (model.getTerminal(edge, true) !== fromCell)
            {
                points.reverse();
            }
        }

        return points;
    }

    function pointOnRoute(points, progress)
    {
        if (points.length === 0)
        {
            return null;
        }

        if (points.length === 1)
        {
            return points[0];
        }

        var lengths = [];
        var total = 0;

        for (var i = 1; i < points.length; i++)
        {
            var dx = points[i].x - points[i - 1].x;
            var dy = points[i].y - points[i - 1].y;
            var length = Math.sqrt(dx * dx + dy * dy);
            lengths.push(length);
            total += length;
        }

        var target = Math.max(0, Math.min(1, progress)) * total;
        var walked = 0;

        for (var j = 0; j < lengths.length; j++)
        {
            if (walked + lengths[j] >= target || j === lengths.length - 1)
            {
                var local = lengths[j] === 0 ? 0 : (target - walked) / lengths[j];
                return {
                    x: points[j].x + (points[j + 1].x - points[j].x) * local,
                    y: points[j].y + (points[j + 1].y - points[j].y) * local
                };
            }

            walked += lengths[j];
        }

        return points[points.length - 1];
    }

    function routeLength(points)
    {
        var total = 0;

        for (var i = 1; i < points.length; i++)
        {
            var dx = points[i].x - points[i - 1].x;
            var dy = points[i].y - points[i - 1].y;
            total += Math.sqrt(dx * dx + dy * dy);
        }

        return total;
    }

    function animateParticle(edge, fromCell, phase, done)
    {
        removeParticles();
        var points = routePoints(edge, fromCell);

        if (points.length < 2)
        {
            done();
            return;
        }

        var totalLength = routeLength(points);

        if (totalLength <= 0)
        {
            done();
            return;
        }

        var duration = totalLength / PARTICLE_SPEED * 1000;
        var trailGap = PARTICLE_TRAIL_GAP / totalLength;

        for (var i = 0; i < 3; i++)
        {
            var particle = h('div', 'af-flow-particle af-particle-' + phase + (i === 0 ? ' af-particle-head' : ' af-particle-trail'));
            particle.setAttribute('data-label', i === 0 ? (phase === 'request' ? 'REQ' : 'RES') : '');
            graph.container.appendChild(particle);
            particles.push(particle);
        }

        var started = window.performance.now();

        function frame(now)
        {
            if (!playing)
            {
                removeParticles();
                return;
            }

            var progress = Math.min(1, (now - started) / duration);

            for (var j = 0; j < particles.length; j++)
            {
                var dotProgress = Math.max(0, progress - j * trailGap);
                var point = pointOnRoute(points, dotProgress);

                if (point != null)
                {
                    particles[j].style.left = point.x + 'px';
                    particles[j].style.top = point.y + 'px';
                    particles[j].style.opacity = progress < j * trailGap ? '0' : String(1 - j * .27);
                }
            }

            if (progress < 1)
            {
                particleFrame = window.requestAnimationFrame(frame);
            }
            else
            {
                removeParticles();
                done();
            }
        }

        particleFrame = window.requestAnimationFrame(frame);
    }

    function gifMovements(flow)
    {
        var result = [];
        var i;

        if (flow.timeline === true)
        {
            for (i = 0; i < flow.steps.length; i++)
            {
                var timelineStep = flow.steps[i];
                var timelineEdge = timelineStep.edgeId != null ? model.getCell(timelineStep.edgeId) : null;
                var timelineFrom = sourceCellFor(timelineStep, null);
                if (timelineEdge != null && timelineFrom != null)
                {
                    result.push({ edge: timelineEdge, from: timelineFrom, phase: timelineStep.direction === 'response' ? 'response' : 'request', step: timelineStep });
                }
            }
            return result;
        }

        for (i = 0; i < flow.steps.length; i++)
        {
            var step = flow.steps[i];
            var edge = step.edgeId != null ? model.getCell(step.edgeId) : null;
            var previous = i > 0 ? cellFor(flow.steps[i - 1]) : null;
            var from = sourceCellFor(step, previous);
            if (edge != null && from != null)
            {
                result.push({ edge: edge, from: from, phase: 'request', step: step });
            }
        }

        for (i = flow.steps.length - 1; i >= 0; i--)
        {
            var responseStep = flow.steps[i];
            var responseEdgeId = responseStep.responseEdgeId != null ? responseStep.responseEdgeId : responseStep.edgeId;
            var responseEdge = responseEdgeId != null ? model.getCell(responseEdgeId) : null;
            var responseFrom = cellFor(responseStep);
            if (responseEdge != null && responseFrom != null)
            {
                result.push({ edge: responseEdge, from: responseFrom, phase: 'response', step: responseStep });
            }
        }

        return result;
    }

    function gifBackground(options)
    {
        var value = options != null ? options.background : null;
        return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
    }

    function svgFrame(movement, progress, options)
    {
        options = options || {};
        var exportScale = options.scale > 0 ? options.scale : 1;
        var border = options.border != null ? Math.max(0, options.border) : 18;
        var bounds = graph.getGraphBounds();
        var background = gifBackground(options);
        var svg = graph.getSvg(options.transparent ? null : background, exportScale, border);
        var viewScale = graph.view.scale || 1;
        var translate = graph.view.translate || new mxPoint();
        var modelBoundsX = bounds.x / viewScale - translate.x;
        var modelBoundsY = bounds.y / viewScale - translate.y;

        function sx(value) { return (value / viewScale - translate.x - modelBoundsX) * exportScale + border; }
        function sy(value) { return (value / viewScale - translate.y - modelBoundsY) * exportScale + border; }

        // Los labels HTML de mxGraph usan foreignObject. Aunque se vean bien,
        // Chromium marca el canvas como cross-origin al rasterizarlos. Se
        // conservan las formas vectoriales reales y se recrea solamente el
        // texto con nodos SVG seguros.
        var unsafe = svg.querySelectorAll('foreignObject,image');
        for (var unsafeIndex = unsafe.length - 1; unsafeIndex >= 0; unsafeIndex--)
        {
            unsafe[unsafeIndex].parentNode.removeChild(unsafe[unsafeIndex]);
        }
        var originalText = svg.querySelectorAll('text');
        for (var originalTextIndex = originalText.length - 1; originalTextIndex >= 0; originalTextIndex--)
        {
            originalText[originalTextIndex].parentNode.removeChild(originalText[originalTextIndex]);
        }

        var gridSize = Math.max(6, graph.gridSize * exportScale);
        var definitions = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        var pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.setAttribute('id', 'af-gif-grid');
        pattern.setAttribute('width', String(gridSize));
        pattern.setAttribute('height', String(gridSize));
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        var gridPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        gridPath.setAttribute('d', 'M ' + gridSize + ' 0 L 0 0 0 ' + gridSize);
        gridPath.setAttribute('fill', 'none');
        gridPath.setAttribute('stroke', '#e5e7eb');
        gridPath.setAttribute('stroke-width', '.65');
        pattern.appendChild(gridPath);
        definitions.appendChild(pattern);
        svg.insertBefore(definitions, svg.firstChild);
        var grid = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        grid.setAttribute('x', '0');
        grid.setAttribute('y', '0');
        grid.setAttribute('width', svg.getAttribute('width'));
        grid.setAttribute('height', svg.getAttribute('height'));
        grid.setAttribute('fill', 'url(#af-gif-grid)');
        var backgroundShape = svg.querySelector('rect[fill="#ffffff"],rect[fill="#FFFFFF"]');
        if (backgroundShape != null && backgroundShape.parentNode != null)
        {
            backgroundShape.parentNode.insertBefore(grid, backgroundShape.nextSibling);
        }
        else
        {
            var firstDrawing = svg.querySelector('g');
            svg.insertBefore(grid, firstDrawing || null);
        }

        function linesFor(cell)
        {
            var div = document.createElement('div');
            div.innerHTML = Graph.sanitizeHtml(graph.convertValueToString(cell) || '');
            var breaks = div.getElementsByTagName('br');
            while (breaks.length > 0)
            {
                breaks[0].parentNode.replaceChild(document.createTextNode('\n'), breaks[0]);
            }
            return (div.textContent || div.innerText || '').split(/\n+/).map(function(line)
            {
                return line.replace(/\s+/g, ' ').trim();
            }).filter(Boolean);
        }

        function exportedVertexRect(cell, state)
        {
            var geometry = model.getGeometry(cell);
            if (geometry == null || geometry.relative)
            {
                return {
                    x: sx(state.x), y: sy(state.y),
                    width: state.width / viewScale * exportScale,
                    height: state.height / viewScale * exportScale
                };
            }

            var x = geometry.x;
            var y = geometry.y;
            var parent = model.getParent(cell);
            while (parent != null && model.isVertex(parent))
            {
                var parentGeometry = model.getGeometry(parent);
                if (parentGeometry != null)
                {
                    x += parentGeometry.x;
                    y += parentGeometry.y;
                }
                parent = model.getParent(parent);
            }
            return {
                x: (x - modelBoundsX) * exportScale + border,
                y: (y - modelBoundsY) * exportScale + border,
                width: geometry.width * exportScale,
                height: geometry.height * exportScale
            };
        }

        function appendText(cell, rect, styleValues)
        {
            var lines = linesFor(cell);
            if (lines.length === 0) return;
            var baseSize = Math.max(7, parseFloat(styleValues[mxConstants.STYLE_FONTSIZE] || '12')) * exportScale;
            var lineSizes = [];
            var totalHeight = 0;
            for (var lineIndex = 0; lineIndex < lines.length; lineIndex++)
            {
                var smaller = lines.length > 1 && lineIndex === lines.length - 1;
                var currentSize = smaller ? Math.max(6, baseSize * .72) : baseSize;
                lineSizes.push(currentSize);
                totalHeight += currentSize * 1.18;
            }
            var align = styleValues[mxConstants.STYLE_ALIGN] || mxConstants.ALIGN_CENTER;
            var vertical = styleValues[mxConstants.STYLE_VERTICAL_ALIGN] || mxConstants.ALIGN_MIDDLE;
            var spacingLeft = parseFloat(styleValues[mxConstants.STYLE_SPACING_LEFT] || '4') * exportScale;
            var spacingTop = parseFloat(styleValues[mxConstants.STYLE_SPACING_TOP] || '4') * exportScale;
            var x = align === mxConstants.ALIGN_LEFT ? rect.x + spacingLeft + 3 * exportScale :
                (align === mxConstants.ALIGN_RIGHT ? rect.x + rect.width - spacingLeft - 3 * exportScale : rect.x + rect.width / 2);
            var textAnchor = align === mxConstants.ALIGN_LEFT ? 'start' : (align === mxConstants.ALIGN_RIGHT ? 'end' : 'middle');
            var y = vertical === mxConstants.ALIGN_TOP ? rect.y + spacingTop + lineSizes[0] :
                rect.y + (rect.height - totalHeight) / 2 + lineSizes[0];
            var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', String(x));
            text.setAttribute('y', String(y));
            text.setAttribute('text-anchor', textAnchor);
            text.setAttribute('fill', styleValues[mxConstants.STYLE_FONTCOLOR] || '#111827');
            text.setAttribute('font-family', styleValues[mxConstants.STYLE_FONTFAMILY] || 'Arial, sans-serif');
            text.setAttribute('font-weight', (parseInt(styleValues[mxConstants.STYLE_FONTSTYLE] || '0', 10) & mxConstants.FONT_BOLD) !== 0 ? '700' : '400');
            for (var tspanIndex = 0; tspanIndex < lines.length; tspanIndex++)
            {
                var tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspan.setAttribute('x', String(x));
                tspan.setAttribute('font-size', String(lineSizes[tspanIndex]));
                if (tspanIndex > 0) tspan.setAttribute('dy', String(lineSizes[tspanIndex - 1] * 1.18));
                tspan.textContent = lines[tspanIndex];
                text.appendChild(tspan);
            }
            svg.appendChild(text);
        }

        for (var cellId in model.cells)
        {
            var renderCell = model.cells[cellId];
            if (renderCell == null || !graph.isCellVisible(renderCell)) continue;
            var renderState = graph.view.getState(renderCell);
            if (renderState == null) continue;
            var renderStyle = graph.getCellStyle(renderCell);
            if (model.isVertex(renderCell) && renderState.width >= 6 && renderState.height >= 6)
            {
                appendText(renderCell, exportedVertexRect(renderCell, renderState), renderStyle);
            }
            else if (model.isEdge(renderCell) && labelFor(renderCell) !== '')
            {
                var edgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                edgeText.setAttribute('x', String(sx(renderState.x + renderState.width / 2)));
                edgeText.setAttribute('y', String(sy(renderState.y + renderState.height / 2) + 3 * exportScale));
                edgeText.setAttribute('text-anchor', 'middle');
                edgeText.setAttribute('fill', renderStyle[mxConstants.STYLE_FONTCOLOR] || '#111827');
                edgeText.setAttribute('font-family', renderStyle[mxConstants.STYLE_FONTFAMILY] || 'Arial, sans-serif');
                edgeText.setAttribute('font-size', String(Math.max(6, parseFloat(renderStyle[mxConstants.STYLE_FONTSIZE] || '10')) * exportScale));
                edgeText.setAttribute('paint-order', 'stroke');
                edgeText.setAttribute('stroke', '#ffffff');
                edgeText.setAttribute('stroke-width', String(4 * exportScale));
                edgeText.textContent = labelFor(renderCell);
                svg.appendChild(edgeText);
            }
        }

        var badgeSteps = activeFlow().steps;
        for (var badgeIndex = 0; badgeIndex < badgeSteps.length; badgeIndex++)
        {
            var badgeCell = cellFor(badgeSteps[badgeIndex]);
            var badgeState = badgeCell != null ? graph.view.getState(badgeCell) : null;
            if (badgeState == null) continue;
            var badgeRect = exportedVertexRect(badgeCell, badgeState);
            var badgeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            badgeCircle.setAttribute('cx', String(badgeRect.x + badgeRect.width - 2 * exportScale));
            badgeCircle.setAttribute('cy', String(badgeRect.y + 2 * exportScale));
            badgeCircle.setAttribute('r', String(8 * exportScale));
            badgeCircle.setAttribute('fill', '#4f46e5');
            badgeCircle.setAttribute('stroke', '#ffffff');
            badgeCircle.setAttribute('stroke-width', String(2 * exportScale));
            svg.appendChild(badgeCircle);
            var badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badgeText.setAttribute('x', badgeCircle.getAttribute('cx'));
            badgeText.setAttribute('y', String(parseFloat(badgeCircle.getAttribute('cy')) + 3 * exportScale));
            badgeText.setAttribute('text-anchor', 'middle');
            badgeText.setAttribute('fill', '#ffffff');
            badgeText.setAttribute('font-family', 'Arial, sans-serif');
            badgeText.setAttribute('font-size', String(8 * exportScale));
            badgeText.setAttribute('font-weight', '700');
            badgeText.textContent = String(badgeIndex + 1);
            svg.appendChild(badgeText);
        }
        var points = routePoints(movement.edge, movement.from);
        var overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        var color = movement.phase === 'response' ? '#10b981' : '#6366f1';
        var label = movement.phase === 'response' ? 'RES' : 'REQ';

        for (var i = 2; i >= 0; i--)
        {
            var dot = pointOnRoute(points, Math.max(0, progress - i * .055));
            if (dot == null) continue;
            var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(sx(dot.x)));
            circle.setAttribute('cy', String(sy(dot.y)));
            circle.setAttribute('r', String((i === 0 ? 8 : 5 - i) * exportScale));
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', String((i === 0 ? 3 : 1.5) * exportScale));
            circle.setAttribute('opacity', String(1 - i * .28));
            overlay.appendChild(circle);
        }

        var point = pointOnRoute(points, progress);
        if (point != null)
        {
            var badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badge.setAttribute('x', String(sx(point.x) + 13 * exportScale));
            badge.setAttribute('y', String(sy(point.y) - 10 * exportScale));
            badge.setAttribute('fill', color);
            badge.setAttribute('font-family', 'Arial, sans-serif');
            badge.setAttribute('font-size', String(11 * exportScale));
            badge.setAttribute('font-weight', '700');
            badge.textContent = label;
            overlay.appendChild(badge);
        }

        svg.appendChild(overlay);
        return svg;
    }

    function rasterizeSvg(svg, background)
    {
        return new Promise(function(resolve, reject)
        {
            var width = Math.max(1, Math.ceil(parseFloat(svg.getAttribute('width')) || 1));
            var height = Math.max(1, Math.ceil(parseFloat(svg.getAttribute('height')) || 1));
            var scale = Math.min(1, 1000 / Math.max(width, height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            var context = canvas.getContext('2d', { willReadFrequently: true });
            var source = new XMLSerializer().serializeToString(svg);
            var url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
            var image = new Image();
            image.onload = function()
            {
                if (background != null)
                {
                    context.fillStyle = background;
                    context.fillRect(0, 0, canvas.width, canvas.height);
                }
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve({ data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height });
            };
            image.onerror = function()
            {
                URL.revokeObjectURL(url);
                reject(new Error('No se pudo convertir el diagrama en un fotograma.'));
            };
            image.src = url;
        });
    }

    function createNativeGifSvg(options)
    {
        var background = options.transparent ? null : gifBackground(options);
        return graph.getSvg(background, options.scale > 0 ? options.scale : 1,
            options.border != null ? Math.max(0, options.border) : 0, true, null, true,
            null, null, null, graph.shadowVisible, null, options.theme || null);
    }

    function convertNativeGifSvg(svg)
    {
        return new Promise(function(resolve)
        {
            ui.editor.convertImages(svg, function(convertedSvg)
            {
                resolve(convertedSvg);
            }, null, ui.editor.createImageUrlConverter());
        });
    }

    function nativeGifFrame(baseSvg, movement, progress, options)
    {
        var svg = baseSvg.cloneNode(true);
        var bounds = graph.getGraphBounds();
        var viewScale = graph.view.scale || 1;
        var translate = graph.view.translate || new mxPoint();
        var exportScale = options.scale > 0 ? options.scale : 1;
        var border = options.border != null ? Math.max(0, options.border) : 0;
        var modelBoundsX = bounds.x / viewScale - translate.x;
        var modelBoundsY = bounds.y / viewScale - translate.y;
        var sx = function(value) { return (value / viewScale - translate.x - modelBoundsX) * exportScale + border; };
        var sy = function(value) { return (value / viewScale - translate.y - modelBoundsY) * exportScale + border; };
        var points = routePoints(movement.edge, movement.from);
        var overlay = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        overlay.setAttribute('data-archiflow-bubble', movement.phase);
        var color = movement.phase === 'response' ? '#10b981' : '#6366f1';
        var label = movement.phase === 'response' ? 'RES' : 'REQ';
        var physicalGap = points.length > 1 ? PARTICLE_TRAIL_GAP * viewScale / Math.max(1, routeLength(points)) : 0;

        for (var i = 2; i >= 0; i--)
        {
            var dot = pointOnRoute(points, Math.max(0, progress - i * physicalGap));
            if (dot == null) continue;
            var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(sx(dot.x)));
            circle.setAttribute('cy', String(sy(dot.y)));
            circle.setAttribute('r', String((i === 0 ? 8 : 5 - i) * exportScale));
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', String((i === 0 ? 3 : 1.5) * exportScale));
            circle.setAttribute('opacity', String(1 - i * .28));
            overlay.appendChild(circle);
        }

        var point = pointOnRoute(points, progress);
        if (point != null)
        {
            var badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badge.setAttribute('x', String(sx(point.x) + 13 * exportScale));
            badge.setAttribute('y', String(sy(point.y) - 10 * exportScale));
            badge.setAttribute('fill', color);
            badge.setAttribute('font-family', 'Arial, sans-serif');
            badge.setAttribute('font-size', String(11 * exportScale));
            badge.setAttribute('font-weight', '700');
            badge.textContent = label;
            overlay.appendChild(badge);
        }

        svg.appendChild(overlay);
        return svg;
    }

    function rasterizeNativeGifFrame(svg, width, height, renderScale, background)
    {
        return new Promise(function(resolve, reject)
        {
            var canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            var context = canvas.getContext('2d');
            var image = new Image();
            image.onload = function()
            {
                if (background != null)
                {
                    context.fillStyle = background;
                    context.fillRect(0, 0, width, height);
                }

                if (renderScale < 1) context.scale(renderScale, renderScale);
                context.drawImage(image, 0, 0);
                resolve(canvas);
            };
            image.onerror = function() { reject(new Error('Draw.io no pudo rasterizar el fotograma SVG.')); };
            image.src = Editor.createSvgDataUri(mxUtils.getXml(svg));
        });
    }

    async function exportActiveFlowGif(options)
    {
        options = options || {};
        var flow = activeFlow();
        var movements = gifMovements(flow);
        if (movements.length === 0)
        {
            toast('El flujo activo no tiene flechas animables');
            return;
        }

        stopPlayback(true);
        exportingGif = true;
        renderToolbarState();
        var originalText = gifButton.textContent;

        try
        {
            if (typeof GifEncoder !== 'function')
            {
                throw new Error('El codificador GIF nativo de Draw.io no está disponible.');
            }

            var baseSvg = await convertNativeGifSvg(createNativeGifSvg(options));
            var sourceWidth = Math.max(1, parseInt(baseSvg.getAttribute('width'), 10) || 1);
            var sourceHeight = Math.max(1, parseInt(baseSvg.getAttribute('height'), 10) || 1);
            var renderScale = Math.min(1, ui.editor.getMaxCanvasScale(sourceWidth, sourceHeight, 1));
            var outputWidth = Math.max(1, Math.ceil(sourceWidth * renderScale));
            var outputHeight = Math.max(1, Math.ceil(sourceHeight * renderScale));
            var encoder = new GifEncoder(outputWidth, outputHeight);
            var fps = Math.max(4, Math.min(30, parseInt(options.fps, 10) || 15));
            encoder.setDelay(Math.round(1000 / fps));
            encoder.setRepeat(options.repeat != null ? options.repeat : 0);
            encoder.setTransparent(options.transparent === true);
            var viewScale = graph.view.scale || 1;
            var lengths = [];
            var totalLength = 0;
            var movementIndex;

            for (movementIndex = 0; movementIndex < movements.length; movementIndex++)
            {
                var movementLength = routeLength(routePoints(movements[movementIndex].edge, movements[movementIndex].from)) / viewScale;
                movementLength = Math.max(1, movementLength);
                lengths.push(movementLength);
                totalLength += movementLength;
            }

            var frameBudget = Math.max(movements.length * 4,
                Math.min(120, Math.ceil(totalLength / PARTICLE_SPEED * fps)));
            var samplesByMovement = [];
            var total = 0;

            for (movementIndex = 0; movementIndex < movements.length; movementIndex++)
            {
                var movementSamples = Math.max(4, Math.round(frameBudget * lengths[movementIndex] / totalLength));
                samplesByMovement.push(movementSamples);
                total += movementSamples;
            }

            var background = options.transparent ? null : gifBackground(options);
            var renderedFrames = 0;

            for (var i = 0; i < movements.length; i++)
            {
                var samples = samplesByMovement[i];
                for (var frame = 0; frame < samples; frame++)
                {
                    gifButton.textContent = 'GIF ' + (renderedFrames + 1) + '/' + total;
                    await new Promise(function(resolve) { window.setTimeout(resolve, 0); });
                    var canvas = await rasterizeNativeGifFrame(
                        nativeGifFrame(baseSvg, movements[i], frame / (samples - 1), options),
                        outputWidth, outputHeight, renderScale, background);
                    encoder.addFrame(canvas);
                    renderedFrames++;
                }
            }

            var blob = encoder.finish();
            if (blob == null) throw new Error('Draw.io no generó fotogramas para el GIF.');
            var download = document.createElement('a');
            var blobUrl = URL.createObjectURL(blob);
            showGifPreview(blobUrl);
            download.href = blobUrl;
            download.download = (flow.name || 'archiflow').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.gif';
            document.body.appendChild(download);
            download.click();
            document.body.removeChild(download);
            window.setTimeout(function()
            {
                URL.revokeObjectURL(blobUrl);
            }, 300000);
            toast('GIF exportado: request y response incluidos');
        }
        catch (error)
        {
            exportingGif = false;
            gifButton.textContent = originalText;
            renderToolbarState();
            ui.handleError(error);
        }
        finally
        {
            exportingGif = false;
            gifButton.textContent = originalText;
            renderToolbarState();
        }
    }

    var drawioAnimatedGifExport = ui.exportAnimatedGif;
    ui.exportAnimatedGif = function(options)
    {
        var flow = activeFlow();

        if (flow.steps != null && flow.steps.length > 0)
        {
            exportActiveFlowGif(options);
            return;
        }

        if (typeof drawioAnimatedGifExport === 'function')
        {
            return drawioAnimatedGifExport.apply(ui, arguments);
        }
    };

    function clearBadges()
    {
        for (var i = 0; i < badges.length; i++)
        {
            graph.removeCellOverlay(badges[i].cell, badges[i].overlay);
        }

        badges = [];
    }

    function badgeImage(number)
    {
        var text = String(number);
        var size = text.length > 1 ? 9 : 11;
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">' +
            '<circle cx="15" cy="15" r="13" fill="#4f46e5" stroke="#fff" stroke-width="3"/>' +
            '<text x="15" y="19" text-anchor="middle" font-family="Arial" font-weight="700" font-size="' +
            size + '" fill="#fff">' + text + '</text></svg>';
        return new mxImage('data:image/svg+xml,' + encodeURIComponent(svg), 30, 30);
    }

    function refreshBadges()
    {
        clearBadges();
        var steps = activeFlow().steps;

        for (var i = 0; i < steps.length; i++)
        {
            var cell = cellFor(steps[i]);

            if (cell != null)
            {
                var overlay = new mxCellOverlay(
                    badgeImage(i + 1),
                    'Paso ' + (i + 1),
                    mxConstants.ALIGN_RIGHT,
                    mxConstants.ALIGN_TOP,
                    new mxPoint(-8, 8),
                    'default'
                );
                graph.addCellOverlay(cell, overlay);
                badges.push({ cell: cell, overlay: overlay });
            }
        }
    }

    function h(tag, className, text)
    {
        var el = document.createElement(tag);

        if (className)
        {
            el.className = className;
        }

        if (text != null)
        {
            el.textContent = text;
        }

        return el;
    }

    function makeButton(text, className, handler)
    {
        var button = h('button', 'af-btn ' + (className || ''), text);
        button.type = 'button';
        mxEvent.addListener(button, 'click', handler);
        return button;
    }

    function showGifPreview(url)
    {
        var previous = document.getElementById('af-gif-preview');
        if (previous != null && previous.parentNode != null) previous.parentNode.removeChild(previous);
        var preview = h('div', 'af-gif-preview');
        preview.id = 'af-gif-preview';
        var previewHead = h('div', 'af-gif-preview-head');
        previewHead.appendChild(h('span', '', 'Vista previa del GIF'));
        var close = h('button', '', '×');
        close.type = 'button';
        close.title = 'Cerrar vista previa';
        previewHead.appendChild(close);
        var image = document.createElement('img');
        image.src = url;
        image.alt = 'Vista previa del flujo ArchiFlow animado';
        preview.appendChild(previewHead);
        preview.appendChild(image);
        document.body.appendChild(preview);
        mxEvent.addListener(close, 'click', function()
        {
            if (preview.parentNode != null) preview.parentNode.removeChild(preview);
        });
    }

    var style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = [
        '.geFormatContainer.af-native-mode{width:410px}',
        '#af-toolbar{display:inline-flex;vertical-align:top;align-items:center;gap:3px;height:30px;margin:4px 0 0 8px;padding-left:9px;border-left:1px solid light-dark(#d1d5db,#4b5563);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#af-toolbar .af-brand{font-weight:700;padding:0 7px 0 2px;color:light-dark(#3730a3,#c7d2fe);letter-spacing:.15px}',
        '.af-btn{min-width:28px;height:28px;border:1px solid transparent;border-radius:5px;padding:3px 7px;background:transparent;color:light-dark(#374151,#e5e7eb);font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}',
        '.af-btn:hover{background:light-dark(#e5e7eb,#374151)}.af-btn:disabled{opacity:.38;cursor:default}',
        '.af-btn-primary{background:light-dark(#e0e7ff,#3730a3);color:light-dark(#3730a3,#eef2ff)}.af-btn-danger{color:light-dark(#b91c1c,#fca5a5)}.af-btn-ghost{color:light-dark(#475569,#cbd5e1)}.af-btn-history{font-size:17px;line-height:1}.af-btn-delete-last{font-size:15px;color:light-dark(#b91c1c,#fca5a5)}',
        '#af-panel{position:static;width:100%;min-height:100%;background:light-dark(#f8fafc,#1b1d1e);color:light-dark(#0f172a,#e5e7eb);border:0;box-shadow:none;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:visible;display:block;margin:0;padding:0}',
        '#af-panel *{box-sizing:border-box}',
        '.af-panel-head{padding:14px 15px 12px;background:light-dark(#eef2ff,#242447);border-bottom:1px solid light-dark(#dbeafe,#3f3f69);color:light-dark(#111827,#f8fafc)}',
        '.af-eyebrow{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:light-dark(#4f46e5,#a5b4fc);margin-bottom:4px}',
        '.af-panel-title{font-size:17px;font-weight:700;line-height:1.25}.af-panel-sub{font-size:11px;color:light-dark(#64748b,#cbd5e1);margin-top:4px;line-height:1.35}',
        '.af-panel-nav{display:grid;grid-template-columns:1fr 1fr;padding:9px 11px 0;background:light-dark(#fff,#1b1d1e);gap:5px}.af-nav-btn{border:0;border-bottom:3px solid transparent;padding:8px 6px;background:transparent;color:light-dark(#64748b,#9ca3af);font-size:11px;font-weight:800;cursor:pointer}.af-nav-btn.af-active{border-bottom-color:#6366f1;color:light-dark(#3730a3,#c7d2fe)}',
        '.af-contract-tools{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px;align-items:center;padding:10px 12px;background:light-dark(#fff,#1b1d1e);border-bottom:1px solid light-dark(#e2e8f0,#333)}.af-import-btn{flex:0 0 auto;border:0;border-radius:7px;padding:8px 10px;background:#6366f1;color:#fff;font-size:11px;font-weight:750;cursor:pointer}.af-contract-target{min-width:0;font-size:10px;color:light-dark(#475569,#b4bbc5);line-height:1.35;overflow-wrap:anywhere}.af-contract-content{padding:12px 12px 30px}.af-contract-empty{border:1px dashed light-dark(#94a3b8,#4b5563);border-radius:10px;padding:18px 12px;text-align:center;color:light-dark(#64748b,#9ca3af);font-size:11px;line-height:1.5}.af-library-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}.af-library-title{font-size:10px;font-weight:850;letter-spacing:.7px;text-transform:uppercase;color:light-dark(#475569,#cbd5e1)}.af-library-count{font:800 9px/1 Arial,sans-serif;color:#6366f1;background:light-dark(#eef2ff,#312e81);padding:4px 6px;border-radius:999px}.af-contract-library{display:flex;gap:6px;overflow-x:auto;padding:1px 1px 10px;margin-bottom:10px;border-bottom:1px solid light-dark(#e2e8f0,#333)}.af-contract-pill{flex:0 0 auto;max-width:190px;border:1px solid light-dark(#cbd5e1,#475569);border-radius:8px;padding:7px 9px;background:light-dark(#fff,#25272b);color:inherit;text-align:left;cursor:pointer}.af-contract-pill.af-active{border-color:#6366f1;background:light-dark(#eef2ff,#312e81);box-shadow:0 0 0 2px rgba(99,102,241,.1)}.af-contract-pill-name{display:block;font-size:10px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.af-contract-pill-file{display:block;margin-top:2px;font:9px/1.2 Consolas,monospace;color:light-dark(#64748b,#a5b4fc);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.af-selection-card{border:1px solid light-dark(#dbe2ea,#3b4048);border-radius:9px;padding:9px 10px;margin-bottom:10px;background:light-dark(#f8fafc,#22252a)}.af-selection-label{font-size:9px;font-weight:850;letter-spacing:.65px;text-transform:uppercase;color:#6366f1}.af-selection-name{font-size:11px;font-weight:750;line-height:1.35;margin-top:4px;overflow-wrap:anywhere}.af-manual-btn{margin-top:7px;border:1px solid light-dark(#cbd5e1,#475569);border-radius:6px;background:light-dark(#fff,#292c31);color:inherit;padding:6px 8px;font-size:9px;font-weight:800;cursor:pointer}.af-api-info{padding:12px;border-radius:11px;background:light-dark(#eef2ff,#272542);border:1px solid light-dark(#c7d2fe,#433f69);margin-bottom:12px}.af-api-title{font-size:17px;font-weight:800}.af-api-meta{font-size:10px;color:light-dark(#64748b,#a5b4fc);margin-top:4px}.af-api-server{font:10px/1.35 Consolas,monospace;margin-top:7px;word-break:break-all;color:light-dark(#334155,#cbd5e1)}',
        '.af-tag{margin:13px 0 7px;font-size:12px;font-weight:850;color:light-dark(#334155,#e2e8f0);display:flex;align-items:center;gap:6px}.af-tag:before{content:"";width:5px;height:15px;border-radius:4px;background:#6366f1}.af-operation{display:block;border:1px solid var(--af-method);border-radius:8px;margin-bottom:8px;background:color-mix(in srgb,var(--af-method) 8%,transparent);overflow:hidden}.af-operation summary{list-style:none;display:grid;grid-template-columns:50px minmax(0,1fr);gap:8px;align-items:center;padding:8px;cursor:pointer}.af-operation summary::-webkit-details-marker{display:none}.af-method{border-radius:5px;padding:5px 3px;background:var(--af-method);color:#fff;text-align:center;font:800 10px Arial,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.15)}.af-operation-path{min-width:0;font:700 11px/1.3 Consolas,monospace;word-break:break-word}.af-operation-summary{grid-column:2;font-size:10px;color:light-dark(#64748b,#9ca3af);margin-top:-4px}.af-operation-body{padding:0 9px 10px;border-top:1px solid color-mix(in srgb,var(--af-method) 35%,transparent)}.af-operation-linkbar{display:flex;align-items:center;gap:7px;padding:8px 0 2px}.af-link-btn{flex:1;border:1px solid var(--af-method);border-radius:6px;background:color-mix(in srgb,var(--af-method) 12%,transparent);color:light-dark(#1f2937,#f8fafc);padding:7px 8px;font-size:9px;font-weight:850;cursor:pointer}.af-link-btn.af-linked{background:var(--af-method);color:#fff}.af-link-btn:disabled{opacity:.45;cursor:default}.af-link-count{flex:0 0 auto;font:800 9px/1 Arial,sans-serif;color:light-dark(#64748b,#aab1bb)}.af-swagger-label{font-size:9px;font-weight:850;letter-spacing:.55px;text-transform:uppercase;color:light-dark(#64748b,#9ca3af);margin:9px 0 4px}.af-swagger-row{font-size:10px;line-height:1.4;padding:5px 7px;border-radius:5px;background:light-dark(#fff,#17191c);margin:3px 0;word-break:break-word}.af-status{display:inline-block;min-width:34px;margin-right:6px;font-family:Consolas,monospace;font-weight:800;color:#10b981}.af-schema{font-family:Consolas,monospace;color:light-dark(#475569,#cbd5e1)}',
        '.af-flowbar{padding:10px 12px;background:light-dark(#fff,#1b1d1e);border-bottom:1px solid light-dark(#e2e8f0,#333);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px}.af-flowbar .af-btn{height:auto;min-height:34px;grid-column:2;grid-row:1}',
        '.af-flowbar select,.af-flowbar input{min-width:0;width:100%;border:1px solid light-dark(#cbd5e1,#48484a);border-radius:7px;padding:8px 9px;background:light-dark(#fff,#1c1c1e);color:light-dark(#0f172a,#e5e7eb)}.af-flowbar select{grid-column:1;grid-row:1}.af-flowbar input{grid-column:1/-1;grid-row:2}',
        '.af-steps{padding:10px 11px;background:light-dark(#f6f8fb,#202126);border-bottom:1px solid light-dark(#dbe2ea,#333);display:flex;flex-direction:column;gap:7px;max-height:210px;overflow-y:auto;overflow-x:hidden}',
        '.af-step-chip{position:relative;width:100%;border:1px solid light-dark(#d7dde5,#454950);background:light-dark(#fff,#27292d);color:inherit;border-radius:9px;padding:8px 9px;cursor:pointer;text-align:left;display:grid;grid-template-columns:24px 48px minmax(0,1fr);gap:7px;align-items:start;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}',
        '.af-step-chip:hover{border-color:light-dark(#94a3b8,#6b7280)}.af-step-chip.af-active{border-color:#6366f1;background:light-dark(#f8f9ff,#292a3d);box-shadow:inset 3px 0 0 #6366f1,0 0 0 2px rgba(99,102,241,.1)}.af-step-chip.af-phase-active-response{border-color:#10b981;box-shadow:inset 3px 0 0 #10b981,0 0 0 2px rgba(16,185,129,.1)}',
        '.af-step-no{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:light-dark(#eef2f7,#3a3d43);color:light-dark(#475569,#cbd5e1);font:800 10px/1 Arial,sans-serif}.af-step-chip.af-active .af-step-no{background:#6366f1;color:#fff}.af-step-chip.af-phase-active-response .af-step-no{background:#10b981}',
        '.af-step-method{border-radius:4px;padding:4px 3px;background:var(--af-method);color:#fff;text-align:center;font:800 9px/1.2 Arial,sans-serif;letter-spacing:.2px}.af-step-copy{min-width:0}.af-step-name{display:block;font:750 11px/1.35 Consolas,monospace;overflow-wrap:anywhere;color:light-dark(#0f172a,#f1f5f9)}.af-step-summary{display:block;margin-top:3px;font-size:10px;line-height:1.3;color:light-dark(#64748b,#aab1bb);overflow-wrap:anywhere}',
        '.af-step-actions{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;padding:8px 11px 10px;background:light-dark(#fff,#1b1d1e);border-bottom:1px solid light-dark(#e2e8f0,#333)}.af-step-action{min-width:0;border:1px solid light-dark(#cbd5e1,#475569);border-radius:6px;padding:6px 5px;background:light-dark(#fff,#25272b);color:inherit;font-size:10px;font-weight:750;cursor:pointer;white-space:nowrap}.af-step-action:nth-child(1),.af-step-action:nth-child(2){grid-column:span 3}.af-step-action:nth-child(n+3){grid-column:span 2}.af-step-action:hover{border-color:#6366f1}.af-step-action:disabled{opacity:.35;cursor:default}.af-step-action-danger{color:#dc2626;border-color:light-dark(#fecaca,#7f1d1d)}',
        '.af-content{padding:13px 14px 28px;overflow:visible}.af-empty{padding:28px 14px;text-align:center;color:light-dark(#64748b,#a0a0a0);line-height:1.5}',
        '.af-kicker{font-size:10px;color:#6366f1;font-weight:850;text-transform:uppercase;letter-spacing:.8px}.af-object{font-size:14px;font-weight:750;margin:4px 0 10px;color:light-dark(#475569,#cbd5e1);overflow-wrap:anywhere}',
        '.af-endpoint-hero{--af-method:#6366f1;border:1px solid color-mix(in srgb,var(--af-method) 70%,transparent);border-radius:10px;background:color-mix(in srgb,var(--af-method) 8%,transparent);padding:10px;margin:8px 0 12px}.af-endpoint-line{display:grid;grid-template-columns:52px minmax(0,1fr);gap:8px;align-items:start}.af-endpoint-method{border-radius:5px;background:var(--af-method);color:#fff;text-align:center;padding:6px 3px;font:850 10px/1 Arial,sans-serif}.af-endpoint-path{font:800 12px/1.4 Consolas,monospace;overflow-wrap:anywhere}.af-endpoint-purpose{margin:7px 0 0 60px;font-size:10px;line-height:1.4;color:light-dark(#64748b,#aab1bb)}',
        '.af-section{border:1px solid light-dark(#dbe2ea,#3b4048);border-radius:10px;padding:0 10px 10px;margin-top:11px;background:light-dark(#fff,#202226);overflow:hidden}.af-section-head{margin:0 -10px 10px;padding:9px 10px;border-bottom:1px solid light-dark(#e2e8f0,#3b4048);background:light-dark(#f8fafc,#26292e)}.af-section-title{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:850;letter-spacing:.7px;text-transform:uppercase;color:light-dark(#334155,#e2e8f0)}.af-section-title:before{content:"";width:7px;height:7px;border-radius:50%;background:#64748b}.af-section-sub{font-size:9px;line-height:1.35;color:light-dark(#64748b,#9ca3af);margin:4px 0 0 14px}.af-section-request{border-color:light-dark(#c7d2fe,#3730a3)}.af-section-request .af-section-head{background:light-dark(#eef2ff,#292856);border-bottom-color:light-dark(#c7d2fe,#3730a3)}.af-section-request .af-section-title{color:light-dark(#3730a3,#c7d2fe)}.af-section-request .af-section-title:before{background:#6366f1}.af-section-response{border-color:light-dark(#a7f3d0,#065f46)}.af-section-response .af-section-head{background:light-dark(#ecfdf5,#123d34);border-bottom-color:light-dark(#a7f3d0,#065f46)}.af-section-response .af-section-title{color:light-dark(#047857,#a7f3d0)}.af-section-response .af-section-title:before{background:#10b981}',
        '.af-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.af-field{display:block;margin-bottom:9px}.af-field span{display:block;font-size:11px;font-weight:700;color:light-dark(#475569,#cbd5e1);margin-bottom:5px}',
        '.af-field input,.af-field textarea,.af-field select{width:100%;border:1px solid light-dark(#cbd5e1,#48484a);border-radius:6px;padding:8px 9px;background:light-dark(#fff,#1c1c1e);color:light-dark(#0f172a,#e5e7eb);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '.af-field textarea{min-height:58px;resize:vertical;font-family:Consolas,monospace;font-size:11px;line-height:1.4}',
        '.af-live{background:#0f172a;color:#e2e8f0;border-radius:10px;padding:10px 11px;margin-top:8px;white-space:pre-wrap;word-break:break-word;font:11px/1.45 Consolas,monospace}',
        '.af-live-label{font-size:10px;text-transform:uppercase;letter-spacing:.65px;color:#94a3b8;margin:10px 0 4px}.af-live-label:first-child{margin-top:0}',
        '.af-roundtrip{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:8px 0 12px}.af-phase{border:1px solid light-dark(#cbd5e1,#475569);border-radius:8px;padding:8px 7px;font-size:9px;font-weight:850;letter-spacing:.45px;text-transform:uppercase;background:light-dark(#fff,#25272b);color:light-dark(#94a3b8,#7f8792)}',
        '.af-phase-request.af-current{border-color:#6366f1;background:light-dark(#eef2ff,#312e81);color:light-dark(#3730a3,#e0e7ff);box-shadow:0 0 0 2px rgba(99,102,241,.12)}.af-phase-response.af-current{border-color:#10b981;background:light-dark(#ecfdf5,#064e3b);color:light-dark(#047857,#d1fae5);box-shadow:0 0 0 2px rgba(16,185,129,.12)}',
        '.af-live-phase-hero{border-radius:11px;padding:12px;margin:8px 0 11px;color:#fff;box-shadow:0 7px 18px rgba(15,23,42,.14)}.af-live-phase-request{background:linear-gradient(135deg,#4f46e5,#6366f1)}.af-live-phase-response{background:linear-gradient(135deg,#047857,#10b981)}.af-live-phase-label{font:850 10px/1 Arial,sans-serif;letter-spacing:1px;text-transform:uppercase}.af-live-phase-route{font:750 12px/1.45 Consolas,monospace;margin-top:8px;overflow-wrap:anywhere}.af-live-phase-count{font-size:9px;margin-top:7px;opacity:.82}',
        '.af-playback-progress{display:flex;gap:5px;margin:7px 0 10px}.af-playback-progress span{height:4px;flex:1;border-radius:999px;background:light-dark(#dbe2ea,#3b4048)}.af-playback-progress span.af-complete{background:light-dark(#a5b4fc,#4338ca)}.af-playback-progress span.af-current-request{background:#6366f1;box-shadow:0 0 0 2px rgba(99,102,241,.13)}.af-playback-progress span.af-current-response{background:#10b981;box-shadow:0 0 0 2px rgba(16,185,129,.13)}',
        '.af-live-card{border:1px solid light-dark(#dbe2ea,#374151);border-radius:11px;padding:10px;margin-top:9px;background:light-dark(#fff,#202226)}.af-live-card.af-current-request{border-color:#818cf8}.af-live-card.af-current-response{border-color:#34d399}.af-live-card-title{font-size:10px;font-weight:850;letter-spacing:.7px;text-transform:uppercase;margin-bottom:7px}.af-live-card-request .af-live-card-title{color:#6366f1}.af-live-card-response .af-live-card-title{color:#10b981}.af-live-empty{font-size:11px;color:light-dark(#94a3b8,#9ca3af);font-style:italic}',
        '.af-flow-particle{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;pointer-events:none;z-index:10025;box-sizing:border-box}.af-particle-request{background:#6366f1;border:2px solid #fff;box-shadow:0 0 0 4px rgba(99,102,241,.2),0 0 15px rgba(99,102,241,.9)}.af-particle-response{background:#10b981;border:2px solid #fff;box-shadow:0 0 0 4px rgba(16,185,129,.2),0 0 15px rgba(16,185,129,.9)}.af-particle-trail{width:8px;height:8px;margin:-4px 0 0 -4px;border-width:1px}.af-particle-head:after{content:attr(data-label);position:absolute;left:17px;top:-5px;padding:2px 4px;border-radius:4px;background:#0f172a;color:#fff;font:700 9px/1.2 Arial,sans-serif;letter-spacing:.3px;box-shadow:0 2px 5px rgba(0,0,0,.25)}',
        '.af-recording{animation:afPulse 1.1s ease-in-out infinite;background:#ef4444!important;color:#fff!important}@keyframes afPulse{50%{opacity:.65}}',
        '.af-toast{position:fixed;left:50%;top:100px;transform:translateX(-50%);z-index:10030;padding:10px 14px;border-radius:9px;background:#111827;color:#fff;font:600 12px Arial,sans-serif;box-shadow:0 8px 25px rgba(0,0,0,.25)}',
        '.af-record-choice{padding:2px 4px;color:light-dark(#0f172a,#f8fafc);font:12px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.af-record-choice h3{font-size:17px;line-height:1.25;margin:0 0 8px}.af-record-choice p{margin:0;color:light-dark(#64748b,#cbd5e1)}.af-record-choice-current{margin:14px 0 12px;padding:10px 11px;border:1px solid light-dark(#c7d2fe,#4338ca);border-radius:8px;background:light-dark(#eef2ff,#292856);font-weight:750;color:light-dark(#3730a3,#e0e7ff)}.af-record-choice-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:13px}.af-record-choice-actions button{min-height:36px;border:1px solid light-dark(#cbd5e1,#475569);border-radius:7px;background:light-dark(#fff,#25272b);color:inherit;font-size:11px;font-weight:750;cursor:pointer}.af-record-choice-actions .af-choice-primary{grid-column:1/-1;background:#6366f1;border-color:#6366f1;color:#fff}.af-record-choice-actions .af-choice-danger{color:light-dark(#b91c1c,#fca5a5)}',
        '.af-gif-preview{position:fixed;left:18px;bottom:18px;z-index:10035;width:min(680px,calc(100vw - 410px));min-width:420px;border:1px solid #94a3b8;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 18px 48px rgba(15,23,42,.32)}.af-gif-preview-head{height:34px;padding:0 8px 0 12px;display:flex;align-items:center;justify-content:space-between;background:#0f172a;color:#fff;font:700 11px Arial,sans-serif}.af-gif-preview-head button{width:25px;height:25px;border:0;border-radius:5px;background:transparent;color:#fff;font-size:19px;line-height:20px;cursor:pointer}.af-gif-preview-head button:hover{background:#334155}.af-gif-preview img{display:block;width:100%;height:auto;max-height:56vh;object-fit:contain;background:#fff}'
    ].join('\n');
    document.head.appendChild(style);

    var toolbar = h('div');
    toolbar.id = 'af-toolbar';
    toolbar.appendChild(h('span', 'af-brand', 'ArchiFlow'));
    var recordButton = makeButton('●', 'af-btn-primary', toggleRecording);
    recordButton.title = 'Grabar o continuar el flujo activo';
    recordButton.setAttribute('aria-label', 'Grabar recorrido');
    var playButton = makeButton('▶', '', function() { playFlow(0); });
    playButton.title = 'Reproducir flujo';
    playButton.setAttribute('aria-label', 'Reproducir flujo');
    var stopButton = makeButton('■', 'af-btn-danger', stopPlayback);
    stopButton.title = 'Detener animación';
    stopButton.setAttribute('aria-label', 'Detener animación');
    var undoButton = makeButton('↶', 'af-btn-ghost af-btn-history', undoFlowChange);
    undoButton.title = 'Deshacer cambio de animación (Ctrl+Z)';
    undoButton.setAttribute('aria-label', 'Deshacer cambio de animación');
    var redoButton = makeButton('↷', 'af-btn-ghost af-btn-history', redoFlowChange);
    redoButton.title = 'Rehacer cambio de animación (Ctrl+Y)';
    redoButton.setAttribute('aria-label', 'Rehacer cambio de animación');
    var deleteLastButton = makeButton('⌫', 'af-btn-ghost af-btn-delete-last', deleteLastStep);
    deleteLastButton.title = 'Eliminar el último paso de la animación';
    deleteLastButton.setAttribute('aria-label', 'Eliminar último paso');
    var panelButton = makeButton('Detalle', 'af-btn-ghost', function()
    {
        activateArchiflowPanel();
    });
    var gifButton = makeButton('GIF', 'af-btn-ghost', exportActiveFlowGif);
    gifButton.title = 'Descargar el flujo activo como GIF animado';
    gifButton.setAttribute('aria-label', 'Exportar GIF animado');
    panelButton.title = 'Abrir la ficha técnica de ArchiFlow';
    toolbar.appendChild(recordButton);
    toolbar.appendChild(playButton);
    toolbar.appendChild(stopButton);
    toolbar.appendChild(undoButton);
    toolbar.appendChild(redoButton);
    toolbar.appendChild(deleteLastButton);
    toolbar.appendChild(gifButton);
    toolbar.appendChild(panelButton);

    if (ui.toolbar != null && ui.toolbar.container != null)
    {
        ui.toolbar.container.appendChild(toolbar);
    }

    var panel = h('div', 'geFormatContent af-native-panel');
    panel.id = 'af-panel';
    var panelHead = h('div', 'af-panel-head');
    panelHead.appendChild(h('div', 'af-eyebrow', 'Arquitectura ejecutable'));
    panelHead.appendChild(h('div', 'af-panel-title', 'Detalle de la consulta'));
    panelHead.appendChild(h('div', 'af-panel-sub', 'Request y response por endpoint, en el orden real de ejecución.'));
    panel.appendChild(panelHead);
    var panelNav = h('div', 'af-panel-nav');
    var contractNavButton = h('button', 'af-nav-btn af-active', 'Contratos');
    contractNavButton.type = 'button';
    var flowNavButton = h('button', 'af-nav-btn', 'Flujo animado');
    flowNavButton.type = 'button';
    panelNav.appendChild(contractNavButton);
    panelNav.appendChild(flowNavButton);
    panel.appendChild(panelNav);
    var contractTools = h('div', 'af-contract-tools');
    var importContractButton = h('button', 'af-import-btn', 'Importar OpenAPI');
    importContractButton.type = 'button';
    importContractButton.title = 'Carga un contrato JSON, YAML o YML en la biblioteca del diagrama';
    var contractTarget = h('div', 'af-contract-target', 'Importa un contrato; después selecciona cualquier figura para enlazarla.');
    var contractFile = document.createElement('input');
    contractFile.type = 'file';
    contractFile.accept = '.json,.yaml,.yml,application/json,application/yaml,text/yaml';
    contractFile.style.display = 'none';
    contractTools.appendChild(importContractButton);
    contractTools.appendChild(contractTarget);
    contractTools.appendChild(contractFile);
    panel.appendChild(contractTools);
    var contractContent = h('div', 'af-contract-content');
    panel.appendChild(contractContent);
    var flowbar = h('div', 'af-flowbar');
    var flowSelect = document.createElement('select');
    var flowName = document.createElement('input');
    flowName.placeholder = 'Nombre del flujo';
    var newFlowButton = makeButton('+ Flujo', 'af-btn-primary', createFlow);
    newFlowButton.title = 'Crear un flujo vacío sin modificar los anteriores';
    flowbar.appendChild(flowSelect);
    flowbar.appendChild(flowName);
    flowbar.appendChild(newFlowButton);
    panel.appendChild(flowbar);
    var stepsStrip = h('div', 'af-steps');
    panel.appendChild(stepsStrip);
    var stepActions = h('div', 'af-step-actions');
    var moveStepLeftButton = h('button', 'af-step-action', '← Mover');
    var moveStepRightButton = h('button', 'af-step-action', 'Mover →');
    var replaceStepButton = h('button', 'af-step-action', 'Reemplazar');
    var insertStepButton = h('button', 'af-step-action', '+ Después');
    var deleteStepButton = h('button', 'af-step-action af-step-action-danger', 'Eliminar');
    var stepActionButtons = [moveStepLeftButton, moveStepRightButton, replaceStepButton, insertStepButton, deleteStepButton];
    moveStepLeftButton.title = 'Mover el paso una posición hacia el inicio';
    moveStepRightButton.title = 'Mover el paso una posición hacia el final';
    replaceStepButton.title = 'Cambiar solamente el componente de este paso';
    insertStepButton.title = 'Insertar un componente después del paso seleccionado';
    deleteStepButton.title = 'Eliminar solamente este paso';
    for (var actionIndex = 0; actionIndex < stepActionButtons.length; actionIndex++)
    {
        stepActionButtons[actionIndex].type = 'button';
        stepActions.appendChild(stepActionButtons[actionIndex]);
    }
    panel.appendChild(stepActions);
    var content = h('div', 'af-content');
    panel.appendChild(content);

    var archiflowTabActive = true;
    var archiflowTab = null;

    function setFormatWidth(width)
    {
        ui.formatWidth = width;
        ui.refresh(true);
        graph.sizeDidChange();
    }

    function activateNativePanel()
    {
        archiflowTabActive = false;
        ui.formatContainer.classList.remove('af-native-mode');
        panel.style.display = 'none';

        if (archiflowTab != null)
        {
            archiflowTab.classList.remove('geActiveFormatTitle');
        }

        setFormatWidth(240);
    }

    function activateArchiflowPanel()
    {
        archiflowTabActive = true;
        installNativePanel();

        if (archiflowTab == null)
        {
            window.setTimeout(activateArchiflowPanel, 60);
            return;
        }

        var titles = ui.formatContainer.querySelectorAll('.geFormatTitle');

        for (var i = 0; i < titles.length; i++)
        {
            titles[i].classList.remove('geActiveFormatTitle');
        }

        var nativeContents = ui.formatContainer.querySelectorAll(':scope > .geFormatContent:not(#af-panel)');

        for (var j = 0; j < nativeContents.length; j++)
        {
            nativeContents[j].style.display = 'none';
        }

        archiflowTab.classList.add('geActiveFormatTitle');
        panel.style.display = '';
        ui.formatContainer.classList.add('af-native-mode');
        setFormatWidth(410);
    }

    function installNativePanel()
    {
        var titleContainer = ui.formatContainer.querySelector('.geFormatTitleContainer');

        if (titleContainer == null)
        {
            return;
        }

        var nativeTitles = titleContainer.querySelectorAll('.geFormatTitle');

        for (var i = 0; i < nativeTitles.length; i++)
        {
            if (nativeTitles[i] !== archiflowTab && nativeTitles[i].getAttribute('data-af-listener') !== '1')
            {
                nativeTitles[i].setAttribute('data-af-listener', '1');
                mxEvent.addListener(nativeTitles[i], 'click', activateNativePanel);
            }
        }

        if (archiflowTab == null)
        {
            archiflowTab = h('div', 'geFormatTitle');
            archiflowTab.title = 'ArchiFlow';
            archiflowTab.appendChild(h('div', '', 'ArchiFlow'));
            mxEvent.addListener(archiflowTab, 'click', activateArchiflowPanel);
        }

        titleContainer.appendChild(archiflowTab);
        ui.formatContainer.appendChild(panel);

        if (archiflowTabActive)
        {
            var nativeContents = ui.formatContainer.querySelectorAll(':scope > .geFormatContent:not(#af-panel)');
            for (var j = 0; j < nativeContents.length; j++)
            {
                nativeContents[j].style.display = 'none';
            }

            var titles = titleContainer.querySelectorAll('.geFormatTitle');
            for (var k = 0; k < titles.length; k++)
            {
                titles[k].classList.remove('geActiveFormatTitle');
            }

            archiflowTab.classList.add('geActiveFormatTitle');
            panel.style.display = '';
            ui.formatContainer.classList.add('af-native-mode');
        }
        else
        {
            panel.style.display = 'none';
        }
    }

    if (ui.format != null)
    {
        var originalImmediateRefresh = ui.format.immediateRefresh;
        ui.format.immediateRefresh = function()
        {
            originalImmediateRefresh.apply(this, arguments);
            installNativePanel();
        };
    }

    installNativePanel();
    activateArchiflowPanel();

    mxEvent.addListener(flowSelect, 'change', function()
    {
        stopPlayback();
        store.activeFlowId = flowSelect.value;
        selectedStep = 0;
        saveStore('Flujo seleccionado');
        render();
    });

    mxEvent.addListener(flowName, 'input', function()
    {
        activeFlow().name = flowName.value.trim() || 'Flujo sin nombre';
        saveStore('Nombre del flujo actualizado');
        var selectedOption = flowSelect.options[flowSelect.selectedIndex];
        if (selectedOption != null)
        {
            selectedOption.textContent = activeFlow().name;
        }
    });

    mxEvent.addListener(contractNavButton, 'click', function()
    {
        panelMode = 'contract';
        render();
    });

    mxEvent.addListener(flowNavButton, 'click', function()
    {
        panelMode = 'flow';
        render();
    });

    mxEvent.addListener(moveStepLeftButton, 'click', function() { moveSelectedStep(-1); });
    mxEvent.addListener(moveStepRightButton, 'click', function() { moveSelectedStep(1); });
    mxEvent.addListener(replaceStepButton, 'click', function() { startStepCapture('replace'); });
    mxEvent.addListener(insertStepButton, 'click', function() { startStepCapture('insert'); });
    mxEvent.addListener(deleteStepButton, 'click', deleteSelectedStep);

    document.addEventListener('keydown', function(event)
    {
        var target = event.target;
        var tagName = target != null && target.tagName != null ? target.tagName.toLowerCase() : '';
        var isEditingText = tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
            (target != null && target.isContentEditable);
        var modifier = event.ctrlKey || event.metaKey;
        var key = String(event.key || '').toLowerCase();
        var handlesFlowHistory = recording || (archiflowTabActive && panelMode === 'flow');

        if (!modifier || isEditingText || !handlesFlowHistory || ui.dialog != null)
        {
            return;
        }

        if (key === 'z' && !event.shiftKey)
        {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            undoFlowChange();
        }
        else if (key === 'y' || (key === 'z' && event.shiftKey))
        {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            redoFlowChange();
        }
    }, true);

    mxEvent.addListener(importContractButton, 'click', function()
    {
        contractFile.value = '';
        contractFile.click();
    });

    mxEvent.addListener(contractFile, 'change', function()
    {
        if (contractFile.files == null || contractFile.files.length === 0)
        {
            return;
        }

        var reader = new FileReader();
        reader.onload = function()
        {
            parseContract(String(reader.result || '')).then(function(contract)
            {
                importContract(contract, contractFile.files[0].name);
            }).catch(function(error)
            {
                ui.handleError(error);
                toast('No se pudo interpretar el contrato');
            });
        };
        reader.readAsText(contractFile.files[0]);
    });

    function toast(message)
    {
        var el = h('div', 'af-toast', message);
        document.body.appendChild(el);
        window.setTimeout(function()
        {
            if (el.parentNode != null)
            {
                el.parentNode.removeChild(el);
            }
        }, 1500);
    }

    function createFlow()
    {
        stopPlayback();
        var flow = { id: uid('flow'), name: 'Nuevo flujo ' + (store.flows.length + 1), steps: [] };
        store.flows.push(flow);
        store.activeFlowId = flow.id;
        selectedStep = 0;
        saveStore('Nuevo flujo creado');
        render();
        flowName.focus();
        flowName.select();
    }

    function applyEndpointDefaults(step, cell)
    {
        var method = graph.getAttributeForCell(cell, 'archiflowHttpMethod', '');
        var path = graph.getAttributeForCell(cell, 'archiflowPath', '');
        var bindings = cellBindings(cell);

        if (method !== '' || path !== '')
        {
            step.operation = (method + ' ' + path).trim();
            step.protocol = 'REST';

            if (bindings.length > 0)
            {
                var record = contractById(bindings[0].contractId);
                var operations = record != null ? contractOperations(record.document) : [];

                for (var i = 0; i < operations.length; i++)
                {
                    if (operations[i].method === bindings[0].method && operations[i].path === bindings[0].path)
                    {
                        applyContractDescriptorToStep(step, operations[i]);
                        break;
                    }
                }

                if (!step.purpose) step.purpose = bindings[0].summary || '';
            }
        }
    }

    function stepForCell(cell)
    {
        var step = emptyStep(cell.id, null, null);
        applyEndpointDefaults(step, cell);
        return step;
    }

    function reconnectSteps(flow)
    {
        for (var i = 0; i < flow.steps.length; i++)
        {
            var current = cellFor(flow.steps[i]);
            var previous = i > 0 ? cellFor(flow.steps[i - 1]) : null;
            var edge = inferEdge(previous, current);
            var responseEdge = inferEdge(current, previous);
            flow.steps[i].edgeId = edge != null ? edge.id : null;
            flow.steps[i].responseEdgeId = responseEdge != null && responseEdge !== edge ? responseEdge.id : null;
        }
    }

    function finishRecording(message)
    {
        recording = false;
        recordingMode = 'new';
        recordButton.textContent = '●';
        recordButton.title = 'Grabar o continuar el flujo activo';
        recordButton.setAttribute('aria-label', 'Grabar recorrido');
        recordButton.classList.remove('af-recording');
        ui.editor.setStatus(message || 'Grabación finalizada: ' + activeFlow().steps.length + ' pasos');
        refreshBadges();
        render();
    }

    function startStepCapture(mode)
    {
        var flow = activeFlow();

        if (flow.steps.length === 0 || flow.steps[selectedStep] == null)
        {
            toast('El flujo todavía no tiene un paso seleccionado');
            return;
        }

        stopPlayback();
        panelMode = 'flow';
        recording = true;
        recordingMode = mode;
        recordButton.textContent = '■';
        recordButton.classList.add('af-recording');
        recordButton.title = 'Cancelar edición del paso';
        recordButton.setAttribute('aria-label', 'Cancelar edición del paso');
        ui.editor.setStatus(mode === 'replace' ? 'Selecciona el componente correcto para reemplazar el paso' : 'Selecciona el componente que deseas insertar');
        toast(mode === 'replace' ? 'Haz clic en el componente correcto' : 'Haz clic en el componente que irá después');
        renderToolbarState();
    }

    function moveSelectedStep(direction)
    {
        var flow = activeFlow();
        var target = selectedStep + direction;

        if (target < 0 || target >= flow.steps.length)
        {
            return;
        }

        rememberFlow(flow);
        var moved = flow.steps[selectedStep];
        flow.steps[selectedStep] = flow.steps[target];
        flow.steps[target] = moved;
        selectedStep = target;
        reconnectSteps(flow);
        saveStore('Paso movido a la posición ' + (selectedStep + 1));
        refreshBadges();
        render();
    }

    function deleteSelectedStep()
    {
        var flow = activeFlow();

        if (flow.steps[selectedStep] == null)
        {
            return;
        }

        rememberFlow(flow);
        flow.steps.splice(selectedStep, 1);
        selectedStep = Math.max(0, Math.min(selectedStep, flow.steps.length - 1));
        reconnectSteps(flow);
        saveStore('Paso eliminado; conexiones vecinas actualizadas');
        refreshBadges();
        render();
        toast('Paso eliminado sin regrabar el flujo');
    }

    function componentForCell(cell)
    {
        var current = cell;

        while (current != null && current !== model.getRoot())
        {
            var kind = graph.getAttributeForCell(current, 'archiflowKind', '');
            if (kind === 'uml-component' || kind === 'component')
            {
                return current;
            }

            current = model.getParent(current);
        }

        return null;
    }

    function endpointRatio(endpoint, component)
    {
        var endpointGeometry = model.getGeometry(endpoint);
        var componentGeometry = model.getGeometry(component);
        if (endpointGeometry == null || componentGeometry == null || componentGeometry.height === 0)
        {
            return .5;
        }

        return Math.max(.08, Math.min(.92,
            (endpointGeometry.y + endpointGeometry.height / 2) / componentGeometry.height));
    }

    function routeManagedEdgeAtComponentBorders(edge, phase, semanticSource, semanticTarget)
    {
        if (edge == null)
        {
            return;
        }

        var sourceEndpointId = graph.getAttributeForCell(edge, 'archiflowSourceEndpoint', null);
        var targetEndpointId = graph.getAttributeForCell(edge, 'archiflowTargetEndpoint', null);
        var sourceTerminal = model.getTerminal(edge, true);
        var targetTerminal = model.getTerminal(edge, false);
        var sourceEndpoint = semanticSource || (sourceEndpointId != null ? model.getCell(sourceEndpointId) : sourceTerminal);
        var targetEndpoint = semanticTarget || (targetEndpointId != null ? model.getCell(targetEndpointId) : targetTerminal);
        var sourceComponent = componentForCell(sourceEndpoint);
        var targetComponent = componentForCell(targetEndpoint);

        if (sourceEndpoint == null || targetEndpoint == null || sourceComponent == null || targetComponent == null ||
            sourceComponent === targetComponent)
        {
            return;
        }

        var sourceGeometry = model.getGeometry(sourceComponent);
        var targetGeometry = model.getGeometry(targetComponent);
        if (sourceGeometry == null || targetGeometry == null)
        {
            return;
        }

        graph.setAttributeForCell(edge, 'archiflowSourceEndpoint', sourceEndpoint.id);
        graph.setAttributeForCell(edge, 'archiflowTargetEndpoint', targetEndpoint.id);
        model.setTerminal(edge, sourceComponent, true);
        model.setTerminal(edge, targetComponent, false);

        var goesRight = sourceGeometry.x + sourceGeometry.width / 2 < targetGeometry.x + targetGeometry.width / 2;
        var styleValue = edge.style || '';
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_EXIT_X, goesRight ? '1' : '0');
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_ENTRY_X, goesRight ? '0' : '1');
        var laneOffset = phase === 'response' ? .025 : -.025;
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_EXIT_Y,
            String(Math.max(.06, Math.min(.94, endpointRatio(sourceEndpoint, sourceComponent) + laneOffset))));
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_ENTRY_Y,
            String(Math.max(.06, Math.min(.94, endpointRatio(targetEndpoint, targetComponent) + laneOffset))));
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_EXIT_DX, '0');
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_EXIT_DY, '0');
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_ENTRY_DX, '0');
        styleValue = mxUtils.setStyle(styleValue, mxConstants.STYLE_ENTRY_DY, '0');
        model.setStyle(edge, styleValue);
        graph.setAttributeForCell(edge, 'archiflowPhase', phase || 'request');
    }

    function normalizeDemoEdges()
    {
        if (store == null || store.flows == null)
        {
            return;
        }

        model.beginUpdate();
        try
        {
            var seen = {};
            for (var flowIndex = 0; flowIndex < store.flows.length; flowIndex++)
            {
                var flowSteps = store.flows[flowIndex].steps || [];
                for (var stepIndex = 0; stepIndex < flowSteps.length; stepIndex++)
                {
                    var managedStep = flowSteps[stepIndex];
                    var managedTarget = cellFor(managedStep);
                    var managedFallback = stepIndex > 0 ? cellFor(flowSteps[stepIndex - 1]) : null;
                    var managedSource = sourceCellFor(managedStep, managedFallback);
                    var managedIds = [managedStep.edgeId, managedStep.responseEdgeId];
                    for (var edgeIndex = 0; edgeIndex < managedIds.length; edgeIndex++)
                    {
                        var managedId = managedIds[edgeIndex];
                        if (managedId != null && !seen[managedId])
                        {
                            seen[managedId] = true;
                            routeManagedEdgeAtComponentBorders(
                                model.getCell(managedId),
                                edgeIndex === 1 ? 'response' : 'request',
                                edgeIndex === 1 ? managedTarget : managedSource,
                                edgeIndex === 1 ? managedSource : managedTarget
                            );
                        }
                    }
                }
            }
        }
        finally
        {
            model.endUpdate();
        }
    }

    function parseContract(text)
    {
        var trimmed = text.trim();

        if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[')
        {
            return Promise.resolve(JSON.parse(trimmed));
        }

        return import('/archiflow-vendor/yaml/index.js').then(function(yaml)
        {
            return yaml.parse(trimmed);
        });
    }

    function contractOperations(contract)
    {
        var result = [];
        var methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
        var paths = contract != null && contract.paths != null ? contract.paths : {};

        for (var path in paths)
        {
            if (!Object.prototype.hasOwnProperty.call(paths, path))
            {
                continue;
            }

            for (var i = 0; i < methods.length; i++)
            {
                var method = methods[i];
                var operation = paths[path] != null ? paths[path][method] : null;

                if (operation != null)
                {
                    result.push({
                        method: method.toUpperCase(),
                        path: path,
                        operation: operation,
                        tag: operation.tags != null && operation.tags.length > 0 ? operation.tags[0] : 'Sin etiqueta'
                    });
                }
            }
        }

        return result;
    }

    function methodColor(method)
    {
        var colors = {
            GET: '#61affe', POST: '#49cc90', PUT: '#fca130',
            PATCH: '#50e3c2', DELETE: '#f93e3e', OPTIONS: '#0d5aa7',
            HEAD: '#9012fe', TRACE: '#6b7280'
        };
        return colors[method] || '#6366f1';
    }

    function schemaText(schema)
    {
        if (schema == null)
        {
            return 'sin esquema';
        }

        if (schema.$ref != null)
        {
            return schema.$ref.split('/').pop();
        }

        if (schema.type === 'array')
        {
            return 'array<' + schemaText(schema.items) + '>';
        }

        if (schema.type === 'object' || schema.properties != null)
        {
            var names = [];
            var properties = schema.properties || {};
            for (var name in properties)
            {
                if (Object.prototype.hasOwnProperty.call(properties, name))
                {
                    names.push(name + ': ' + schemaText(properties[name]));
                }
            }
            return names.length > 0 ? '{ ' + names.join(', ') + ' }' : 'object';
        }

        return schema.type || 'any';
    }

    function importContract(contract, fileName)
    {
        if (contract == null || (contract.openapi == null && contract.swagger == null) || contract.paths == null)
        {
            throw new Error('El archivo no contiene un contrato OpenAPI válido.');
        }

        var operations = contractOperations(contract);

        if (operations.length === 0)
        {
            throw new Error('El contrato no contiene endpoints.');
        }

        var info = contract.info || {};
        var record = {
            id: uid('contract'),
            name: info.title || fileName || 'OpenAPI',
            fileName: fileName || 'openapi',
            document: contract
        };
        store.contracts.push(record);
        store.activeContractId = record.id;
        panelMode = 'contract';
        saveStore(operations.length + ' endpoints añadidos a la biblioteca');
        render();
        toast(record.name + ': ' + operations.length + ' endpoints disponibles para enlazar');
    }

    function toggleRecording()
    {
        if (recording)
        {
            var stoppedMode = recordingMode;
            finishRecording(stoppedMode === 'new' ? null : 'Edición puntual cancelada');
            toast(stoppedMode === 'new' ? 'Recorrido guardado' : 'Edición cancelada');
            return;
        }

        stopPlayback();
        panelMode = 'flow';

        if (activeFlow().steps.length > 0)
        {
            showRecordingChoice();
            return;
        }

        beginRecording(false);
    }

    function beginRecording(restart)
    {
        var flow = activeFlow();

        if (restart)
        {
            rememberFlow(flow);
            flow.steps = [];
            selectedStep = 0;
            saveStore('Flujo reiniciado; el historial permite recuperar los pasos anteriores');
        }
        else
        {
            selectedStep = Math.max(0, flow.steps.length - 1);
        }

        saveStore('Grabación iniciada: selecciona cuadros en orden');
        recording = true;
        recordingMode = 'new';
        recordButton.textContent = '■';
        recordButton.title = 'Finalizar grabación';
        recordButton.setAttribute('aria-label', 'Finalizar grabación');
        recordButton.classList.add('af-recording');
        refreshBadges();
        render();
        toast(restart ? 'Flujo reiniciado: el próximo clic será el paso 1' :
            'Continuando: el próximo clic será el paso ' + (flow.steps.length + 1));
    }

    function showRecordingChoice()
    {
        var flow = activeFlow();
        var dialog = h('div', 'af-record-choice');
        dialog.appendChild(h('h3', null, '¿Cómo quieres continuar la grabación?'));
        dialog.appendChild(h('p', null, 'El flujo activo ya tiene pasos guardados. Puedes continuarlo o empezar nuevamente en este mismo flujo.'));
        dialog.appendChild(h('div', 'af-record-choice-current', flow.name + ' · ' + flow.steps.length +
            (flow.steps.length === 1 ? ' paso guardado' : ' pasos guardados')));
        var actions = h('div', 'af-record-choice-actions');
        var continueButton = h('button', 'af-choice-primary', 'Continuar desde el paso ' + (flow.steps.length + 1));
        var restartButton = h('button', 'af-choice-danger', 'Reiniciar todo');
        var cancelButton = h('button', null, 'Cancelar');
        continueButton.type = restartButton.type = cancelButton.type = 'button';
        actions.appendChild(continueButton);
        actions.appendChild(restartButton);
        actions.appendChild(cancelButton);
        dialog.appendChild(actions);

        mxEvent.addListener(continueButton, 'click', function()
        {
            ui.hideDialog();
            beginRecording(false);
        });
        mxEvent.addListener(restartButton, 'click', function()
        {
            ui.hideDialog();
            beginRecording(true);
        });
        mxEvent.addListener(cancelButton, 'click', function() { ui.hideDialog(); });
        ui.showDialog(dialog, 410, 225, true, true);
        window.setTimeout(function() { continueButton.focus(); }, 0);
    }

    function deleteLastStep()
    {
        var flow = activeFlow();

        if (flow.steps.length > 0)
        {
            rememberFlow(flow);
            flow.steps.pop();
            selectedStep = Math.max(0, flow.steps.length - 1);
            reconnectSteps(flow);
            saveStore('Último paso eliminado');
            refreshBadges();
            render();
            toast('Último paso eliminado; puedes recuperarlo con Ctrl+Z');
        }
    }

    graph.selectionModel.addListener(mxEvent.CHANGE, function()
    {
        var selectedCell = graph.getSelectionCell();

        if (selectedCell != null && model.isVertex(selectedCell))
        {
            selectedContractCellId = selectedCell.id;

            if (panelMode === 'contract')
            {
                render();
            }
        }
        else
        {
            selectedContractCellId = null;
            if (panelMode === 'contract') render();
        }

        if (!recording)
        {
            return;
        }

        var cell = graph.getSelectionCell();

        if (cell != null && model.isEdge(cell))
        {
            ui.editor.setStatus('Las flechas se resuelven automáticamente; selecciona un cuadro');
            return;
        }

        if (!isRecordable(cell))
        {
            return;
        }

        var flow = activeFlow();

        if (recordingMode === 'replace')
        {
            rememberFlow(flow);
            var replaced = flow.steps[selectedStep];
            replaced.cellId = cell.id;
            applyEndpointDefaults(replaced, cell);
            reconnectSteps(flow);
            saveStore('Paso ' + (selectedStep + 1) + ' reemplazado por ' + labelFor(cell));
            finishRecording('Paso reemplazado; conexiones vecinas actualizadas');
            toast('Paso ' + (selectedStep + 1) + ' corregido');
            return;
        }

        if (recordingMode === 'insert')
        {
            rememberFlow(flow);
            selectedStep++;
            flow.steps.splice(selectedStep, 0, stepForCell(cell));
            reconnectSteps(flow);
            saveStore('Paso insertado en la posición ' + (selectedStep + 1));
            finishRecording('Paso insertado; conexiones vecinas actualizadas');
            toast('Paso insertado sin regrabar el flujo');
            return;
        }

        rememberFlow(flow);
        flow.steps.push(stepForCell(cell));
        selectedStep = flow.steps.length - 1;
        reconnectSteps(flow);
        saveStore('Paso ' + flow.steps.length + ': ' + labelFor(cell));
        refreshBadges();
        render();
    });

    function stopPlayback(silent)
    {
        if (playTimer != null)
        {
            window.clearTimeout(playTimer);
            playTimer = null;
        }

        playing = false;
        playbackPhase = 'request';
        restoreCanvas();
        renderToolbarState();

        if (silent !== true)
        {
            render();
        }
    }

    function playTimeline(index)
    {
        var flow = activeFlow();

        if (index >= flow.steps.length)
        {
            stopPlayback();
            toast('Animación completada');
            return;
        }

        if (!playing)
        {
            return;
        }

        removeParticles();

        selectedStep = index;
        var step = flow.steps[index];
        playbackPhase = step.direction === 'response' ? 'response' : 'request';
        var cell = cellFor(step);
        var fromCell = sourceCellFor(step, null);
        var edge = step.edgeId != null ? model.getCell(step.edgeId) : inferEdge(fromCell, cell);

        render();

        function next()
        {
            if (!playing) return;
            playTimer = window.setTimeout(function() { playTimeline(index + 1); }, STEP_DELAY);
        }

        if (edge != null && fromCell != null)
        {
            animateParticle(edge, fromCell, playbackPhase, next);
        }
        else
        {
            next();
        }
    }

    function playFlow(index, phase)
    {
        var flow = activeFlow();
        phase = phase || 'request';

        if (flow.steps.length === 0)
        {
            toast('Graba al menos un paso');
            return;
        }

        if (index === 0 && phase === 'request' && !playing)
        {
            stopPlayback(true);
            playing = true;
            panelMode = 'flow';

            renderToolbarState();

            if (flow.timeline === true)
            {
                playTimeline(0);
                return;
            }
        }

        if (!playing)
        {
            return;
        }

        if (phase === 'request' && index >= flow.steps.length)
        {
            playTimer = window.setTimeout(function()
            {
                playFlow(flow.steps.length - 1, 'response');
            }, STEP_DELAY);
            return;
        }

        if (phase === 'response' && (index < 0 || (index === 0 && flow.steps[0].fromCellId == null)))
        {
            stopPlayback();
            toast('Animación completada');
            return;
        }

        removeParticles();

        selectedStep = index;
        playbackPhase = phase;
        var step = flow.steps[index];
        var cell = cellFor(step);

        var playbackEdgeId = phase === 'response' && step.responseEdgeId != null ? step.responseEdgeId : step.edgeId;
        var edge = playbackEdgeId != null ? model.getCell(playbackEdgeId) : null;

        var previousCell = index > 0 ? cellFor(flow.steps[index - 1]) : null;
        var explicitFromCell = sourceCellFor(step, previousCell);

        if (edge == null && explicitFromCell != null)
        {
            edge = inferEdge(explicitFromCell, cell);
        }

        render();

        function next()
        {
            if (!playing)
            {
                return;
            }

            playTimer = window.setTimeout(function()
            {
                playFlow(phase === 'request' ? index + 1 : index - 1, phase);
            }, STEP_DELAY);
        }

        if (edge != null && explicitFromCell != null)
        {
            animateParticle(edge, phase === 'request' ? explicitFromCell : cell, phase, next);
        }
        else
        {
            next();
        }
    }

    function renderToolbarState()
    {
        var steps = activeFlow().steps;
        var history = historyForFlow(activeFlow());
        recordButton.disabled = playing || exportingGif;
        playButton.disabled = playing || exportingGif;
        stopButton.disabled = !playing || exportingGif;
        gifButton.disabled = playing || exportingGif || gifMovements(activeFlow()).length === 0;
        undoButton.disabled = playing || exportingGif || history.past.length === 0;
        redoButton.disabled = playing || exportingGif || history.future.length === 0;
        deleteLastButton.disabled = playing || exportingGif || steps.length === 0;
        newFlowButton.disabled = playing || exportingGif || recording;
        flowSelect.disabled = playing || exportingGif || recording;
        flowName.disabled = playing || exportingGif || recording;
        moveStepLeftButton.disabled = playing || exportingGif || recording || selectedStep <= 0;
        moveStepRightButton.disabled = playing || exportingGif || recording || selectedStep >= steps.length - 1;
        replaceStepButton.disabled = playing || exportingGif || recording || steps.length === 0;
        insertStepButton.disabled = playing || exportingGif || recording || steps.length === 0;
        deleteStepButton.disabled = playing || exportingGif || recording || steps.length === 0;
    }

    function renderFlowOptions()
    {
        flowSelect.innerHTML = '';

        for (var i = 0; i < store.flows.length; i++)
        {
            var option = document.createElement('option');
            option.value = store.flows[i].id;
            option.textContent = store.flows[i].name;
            option.selected = store.flows[i].id === store.activeFlowId;
            flowSelect.appendChild(option);
        }

        flowName.value = activeFlow().name;
    }

    function operationParts(step)
    {
        var operation = step != null && step.operation != null ? String(step.operation).trim() : '';
        var match = operation.match(/^([A-Za-z]+)\s+(.+)$/);

        if (match != null)
        {
            return { method: match[1].toUpperCase(), path: match[2] };
        }

        return {
            method: 'STEP',
            path: operation || labelFor(cellFor(step))
        };
    }

    function hasCacheData(step)
    {
        if (step == null)
        {
            return false;
        }

        var values = [step.cacheOperation, step.cacheKey, step.cacheData, step.cacheTtl];

        for (var i = 0; i < values.length; i++)
        {
            if (values[i] != null && String(values[i]).trim() !== '')
            {
                return true;
            }
        }

        return /redis|cache|cach[eé]/i.test(step.protocol || '');
    }

    function renderEndpointHero(step)
    {
        var descriptor = operationParts(step);
        var hero = h('div', 'af-endpoint-hero');
        hero.style.setProperty('--af-method', methodColor(descriptor.method));
        var line = h('div', 'af-endpoint-line');
        line.appendChild(h('span', 'af-endpoint-method', descriptor.method));
        line.appendChild(h('span', 'af-endpoint-path', descriptor.path));
        hero.appendChild(line);

        if (step.purpose != null && String(step.purpose).trim() !== '')
        {
            hero.appendChild(h('div', 'af-endpoint-purpose', step.purpose));
        }

        return hero;
    }

    function renderSteps()
    {
        stepsStrip.innerHTML = '';
        var steps = activeFlow().steps;

        if (steps.length === 0)
        {
            stepsStrip.appendChild(h('div', 'af-empty', 'Pulsa “Grabar recorrido” y selecciona cuadros.'));
            return;
        }

        for (var i = 0; i < steps.length; i++)
        {
            (function(stepIndex)
            {
                var step = steps[stepIndex];
                var descriptor = operationParts(step);
                var phaseClass = playing && stepIndex === selectedStep ? ' af-phase-active-' + playbackPhase : '';
                var chip = h('button', 'af-step-chip' + (stepIndex === selectedStep ? ' af-active' : '') + phaseClass);
                chip.type = 'button';
                chip.title = (step.operation || labelFor(cellFor(step))) + (step.purpose ? '\n' + step.purpose : '');
                chip.style.setProperty('--af-method', methodColor(descriptor.method));
                chip.appendChild(h('span', 'af-step-no', String(stepIndex + 1)));
                chip.appendChild(h('span', 'af-step-method', descriptor.method));
                var copy = h('span', 'af-step-copy');
                copy.appendChild(h('span', 'af-step-name', descriptor.path));
                copy.appendChild(h('span', 'af-step-summary', step.purpose || labelFor(cellFor(step))));
                chip.appendChild(copy);
                mxEvent.addListener(chip, 'click', function()
                {
                    selectedStep = stepIndex;
                    render();
                });
                stepsStrip.appendChild(chip);
            })(i);
        }
    }

    function addField(parent, label, field, value, textarea, options)
    {
        var wrapper = h('label', 'af-field');
        wrapper.appendChild(h('span', '', label));
        var input;

        if (options != null)
        {
            input = document.createElement('select');
            for (var i = 0; i < options.length; i++)
            {
                var option = document.createElement('option');
                option.value = options[i];
                option.textContent = options[i];
                option.selected = options[i] === value;
                input.appendChild(option);
            }
        }
        else
        {
            input = document.createElement(textarea ? 'textarea' : 'input');
            input.value = value || '';
        }

        input.setAttribute('data-field', field);
        mxEvent.addListener(input, 'change', function()
        {
            var flow = activeFlow();
            if (flow.steps[selectedStep] != null)
            {
                flow.steps[selectedStep][field] = input.value;
                saveStore('Detalle técnico actualizado');

                if (field === 'protocol')
                {
                    window.setTimeout(render, 0);
                }
            }
        });
        wrapper.appendChild(input);
        parent.appendChild(wrapper);
    }

    function section(title, tone, subtitle)
    {
        var el = h('section', 'af-section' + (tone ? ' af-section-' + tone : ''));
        var head = h('div', 'af-section-head');
        head.appendChild(h('div', 'af-section-title', title));

        if (subtitle != null && subtitle !== '')
        {
            head.appendChild(h('div', 'af-section-sub', subtitle));
        }

        el.appendChild(head);
        return el;
    }

    function liveValue(parent, label, value)
    {
        if (value == null || String(value).trim() === '')
        {
            return;
        }

        parent.appendChild(h('div', 'af-live-label', label));
        parent.appendChild(h('div', 'af-live', String(value)));
    }

    function liveCard(parent, title, tone, active, values)
    {
        var card = h('div', 'af-live-card af-live-card-' + tone + (active ? ' af-current-' + tone : ''));
        card.appendChild(h('div', 'af-live-card-title', title));
        var count = 0;

        for (var i = 0; i < values.length; i++)
        {
            if (values[i][1] != null && String(values[i][1]).trim() !== '')
            {
                liveValue(card, values[i][0], values[i][1]);
                count++;
            }
        }

        if (count === 0)
        {
            card.appendChild(h('div', 'af-live-empty', 'Sin datos registrados para esta fase.'));
        }

        parent.appendChild(card);
    }

    function renderLive(step)
    {
        content.innerHTML = '';
        var isRequest = playbackPhase === 'request';
        var flow = activeFlow();
        var currentLabel = labelFor(cellFor(step));
        var currentOperation = operationParts(step);
        var currentRoute = currentOperation.method + ' ' + currentOperation.path;
        var previousRoute = 'Cliente / origen';

        if (selectedStep > 0)
        {
            var previousOperation = operationParts(flow.steps[selectedStep - 1]);
            previousRoute = previousOperation.method + ' ' + previousOperation.path;
        }

        var route = isRequest ? previousRoute + '  →  ' + currentRoute : currentRoute + '  →  ' + previousRoute;
        content.appendChild(h('div', 'af-kicker', 'Ejecución en vivo'));
        var progress = h('div', 'af-playback-progress');

        for (var progressIndex = 0; progressIndex < flow.steps.length; progressIndex++)
        {
            var progressClass = progressIndex < selectedStep ? ' af-complete' : '';

            if (progressIndex === selectedStep)
            {
                progressClass += ' af-current-' + playbackPhase;
            }

            var progressStep = h('span', progressClass.trim());
            progressStep.title = 'Paso ' + (progressIndex + 1) + ' de ' + flow.steps.length;
            progress.appendChild(progressStep);
        }

        content.appendChild(progress);
        var phaseHero = h('div', 'af-live-phase-hero af-live-phase-' + playbackPhase);
        phaseHero.appendChild(h('div', 'af-live-phase-label', isRequest ? 'IDA · REQUEST' : 'VUELTA · RESPONSE'));
        phaseHero.appendChild(h('div', 'af-live-phase-route', route));
        phaseHero.appendChild(h('div', 'af-live-phase-count', 'Paso ' + (selectedStep + 1) + ' de ' + flow.steps.length));
        content.appendChild(phaseHero);
        var phases = h('div', 'af-roundtrip');
        phases.appendChild(h('div', 'af-phase af-phase-request' + (isRequest ? ' af-current' : ''), '1 · REQUEST →'));
        phases.appendChild(h('div', 'af-phase af-phase-response' + (!isRequest ? ' af-current' : ''), '2 · ← RESPONSE'));
        content.appendChild(phases);
        content.appendChild(renderEndpointHero(step));
        liveValue(content, 'Componente', currentLabel);
        liveValue(content, 'Protocolo', step.protocol);

        if (isRequest)
        {
            liveCard(content, 'Datos enviados · REQUEST', 'request', true, [
                ['Path params', step.pathParams],
                ['Query params', step.queryParams],
                ['Headers', step.requestHeaders],
                ['Request body', step.requestBody]
            ]);
        }
        else
        {
            liveCard(content, 'Datos recibidos · RESPONSE', 'response', true, [
                ['Status', step.responseStatus],
                ['Headers', step.responseHeaders],
                ['Response body', step.responseBody]
            ]);
        }

        if (hasCacheData(step))
        {
            liveValue(content, 'Caché', [step.cacheOperation, step.cacheKey, step.cacheData, step.cacheTtl].filter(Boolean).join('\n'));
        }

        liveValue(content, 'Notas', step.notes);
    }

    function renderEditor(step)
    {
        content.innerHTML = '';
        content.appendChild(h('div', 'af-kicker', 'Paso ' + (selectedStep + 1) + ' de ' + activeFlow().steps.length));
        content.appendChild(renderEndpointHero(step));
        content.appendChild(h('div', 'af-object', 'Componente · ' + labelFor(cellFor(step))));

        var general = section('Operación', '', 'Identidad del endpoint y propósito dentro del flujo.');
        var generalGrid = h('div', 'af-grid');
        addField(generalGrid, 'Operación', 'operation', step.operation, false);
        addField(generalGrid, 'Protocolo', 'protocol', step.protocol, false, ['HTTPS', 'HTTP', 'REST', 'gRPC', 'Redis', 'SQL', 'Kafka', 'AMQP', 'Interno']);
        general.appendChild(generalGrid);
        addField(general, 'Propósito', 'purpose', step.purpose, false);
        content.appendChild(general);

        var request = section('REQUEST · datos enviados', 'request', 'Parámetros, headers y body que salen hacia el siguiente componente.');
        var params = h('div', 'af-grid');
        addField(params, 'Path params', 'pathParams', step.pathParams, true);
        addField(params, 'Query params', 'queryParams', step.queryParams, true);
        request.appendChild(params);
        addField(request, 'Request headers', 'requestHeaders', step.requestHeaders, true);
        addField(request, 'Request body', 'requestBody', step.requestBody, true);
        content.appendChild(request);

        var response = section('RESPONSE · datos recibidos', 'response', 'Status, headers y body que regresan al componente de origen.');
        addField(response, 'Response status', 'responseStatus', step.responseStatus, false);
        addField(response, 'Response headers', 'responseHeaders', step.responseHeaders, true);
        addField(response, 'Response body', 'responseBody', step.responseBody, true);
        content.appendChild(response);

        if (hasCacheData(step))
        {
            var cache = section('Caché', '', 'Solo aparece cuando el paso usa Redis o tiene datos de caché definidos.');
            var cacheGrid = h('div', 'af-grid');
            addField(cacheGrid, 'Operación', 'cacheOperation', step.cacheOperation, false);
            addField(cacheGrid, 'TTL', 'cacheTtl', step.cacheTtl, false);
            cache.appendChild(cacheGrid);
            addField(cache, 'Clave / recurso', 'cacheKey', step.cacheKey, false);
            addField(cache, 'Datos utilizados o guardados', 'cacheData', step.cacheData, true);
            content.appendChild(cache);
        }

        var notes = section('Contexto', '', 'Información adicional que ayuda a interpretar este paso.');
        addField(notes, 'Notas', 'notes', step.notes, true);
        content.appendChild(notes);
    }

    function appendSwaggerRow(parent, text, className)
    {
        parent.appendChild(h('div', 'af-swagger-row' + (className ? ' ' + className : ''), text));
    }

    function renderSwaggerOperation(parent, descriptor, contractRecord)
    {
        var operation = descriptor.operation || {};
        var details = h('details', 'af-operation');
        details.style.setProperty('--af-method', methodColor(descriptor.method));
        var summary = document.createElement('summary');
        summary.appendChild(h('span', 'af-method', descriptor.method));
        summary.appendChild(h('span', 'af-operation-path', descriptor.path));
        summary.appendChild(h('span', 'af-operation-summary', operation.summary || operation.operationId || 'Sin descripción'));
        details.appendChild(summary);
        var body = h('div', 'af-operation-body');
        var linkbar = h('div', 'af-operation-linkbar');
        var selectedCell = selectedContractCell();
        var linked = selectedCell != null && isCellBoundTo(selectedCell, contractRecord.id, descriptor);
        var linkButton = h('button', 'af-link-btn' + (linked ? ' af-linked' : ''),
            linked ? '✓ Enlazado a esta figura' : 'Enlazar figura seleccionada');
        linkButton.type = 'button';
        linkButton.disabled = selectedCell == null;
        linkButton.title = selectedCell != null ? labelFor(selectedCell) : 'Selecciona cualquier figura del lienzo';
        mxEvent.addListener(linkButton, 'click', function(event)
        {
            mxEvent.consume(event);
            toggleEndpointBinding(contractRecord, descriptor);
        });
        linkbar.appendChild(linkButton);
        var links = bindingCount(contractRecord.id, descriptor);
        linkbar.appendChild(h('span', 'af-link-count', links + (links === 1 ? ' enlace' : ' enlaces')));
        body.appendChild(linkbar);

        if (operation.operationId != null)
        {
            body.appendChild(h('div', 'af-swagger-label', 'Operation ID'));
            appendSwaggerRow(body, operation.operationId, 'af-schema');
        }

        var parameters = operation.parameters || [];
        if (parameters.length > 0)
        {
            body.appendChild(h('div', 'af-swagger-label', 'Parámetros'));
            for (var i = 0; i < parameters.length; i++)
            {
                var parameter = parameters[i];
                appendSwaggerRow(body, parameter.name + ' · ' + (parameter.in || 'query') +
                    (parameter.required ? ' · requerido' : '') + ' · ' + schemaText(parameter.schema), 'af-schema');
            }
        }

        if (operation.requestBody != null)
        {
            body.appendChild(h('div', 'af-swagger-label', 'Request body'));
            var requestContent = operation.requestBody.content || {};
            var requestCount = 0;
            for (var requestType in requestContent)
            {
                if (Object.prototype.hasOwnProperty.call(requestContent, requestType))
                {
                    appendSwaggerRow(body, requestType + ' · ' + schemaText(requestContent[requestType].schema), 'af-schema');
                    requestCount++;
                }
            }
            if (requestCount === 0)
            {
                appendSwaggerRow(body, operation.requestBody.description || 'Body definido');
            }
        }

        var responses = operation.responses || {};
        body.appendChild(h('div', 'af-swagger-label', 'Responses'));
        var responseCount = 0;
        for (var status in responses)
        {
            if (Object.prototype.hasOwnProperty.call(responses, status))
            {
                var response = responses[status] || {};
                var row = h('div', 'af-swagger-row');
                row.appendChild(h('span', 'af-status', status));
                row.appendChild(document.createTextNode(response.description || 'Respuesta'));
                var responseContent = response.content || {};
                var responseSchemas = [];
                for (var responseType in responseContent)
                {
                    if (Object.prototype.hasOwnProperty.call(responseContent, responseType))
                    {
                        responseSchemas.push(responseType + ': ' + schemaText(responseContent[responseType].schema));
                    }
                }
                if (responseSchemas.length > 0)
                {
                    row.appendChild(h('div', 'af-schema', responseSchemas.join('\n')));
                }
                body.appendChild(row);
                responseCount++;
            }
        }

        if (responseCount === 0)
        {
            appendSwaggerRow(body, 'Sin responses declarados');
        }

        details.appendChild(body);
        parent.appendChild(details);
    }

    function appendSelectedCellCard(parent, cell)
    {
        if (cell == null) return;
        var selectionCard = h('div', 'af-selection-card');
        selectionCard.appendChild(h('div', 'af-selection-label', 'Figura lista para enlazar'));
        selectionCard.appendChild(h('div', 'af-selection-name', labelFor(cell)));
        var manualButton = h('button', 'af-manual-btn', 'Editar datos manuales de request / response');
        manualButton.type = 'button';
        mxEvent.addListener(manualButton, 'click', function()
        {
            var steps = activeFlow().steps;
            var found = -1;
            for (var stepIndex = 0; stepIndex < steps.length; stepIndex++)
            {
                if (steps[stepIndex].cellId === cell.id)
                {
                    found = stepIndex;
                    break;
                }
            }

            if (found < 0)
            {
                toast('Añade esta figura al flujo para registrar manualmente sus datos');
                return;
            }

            selectedStep = found;
            panelMode = 'flow';
            render();
        });
        selectionCard.appendChild(manualButton);
        parent.appendChild(selectionCard);
    }

    function renderContract()
    {
        contractContent.innerHTML = '';
        var selectedCell = selectedContractCell();
        contractTarget.textContent = selectedCell != null ?
            'Figura seleccionada · ' + labelFor(selectedCell) :
            'Selecciona cualquier figura para enlazarla; importar no requiere selección.';
        var contracts = store.contracts || [];
        appendSelectedCellCard(contractContent, selectedCell);

        if (contracts.length === 0)
        {
            contractContent.appendChild(h('div', 'af-contract-empty',
                'Importa uno o varios contratos OpenAPI. Quedarán en esta biblioteca sin modificar ni redimensionar ninguna figura del diagrama.'));
            return;
        }

        var libraryHead = h('div', 'af-library-head');
        libraryHead.appendChild(h('div', 'af-library-title', 'Biblioteca de contratos'));
        libraryHead.appendChild(h('span', 'af-library-count', String(contracts.length)));
        contractContent.appendChild(libraryHead);
        var library = h('div', 'af-contract-library');

        for (var contractIndex = 0; contractIndex < contracts.length; contractIndex++)
        {
            (function(contractRecord)
            {
                var pill = h('button', 'af-contract-pill' +
                    (contractRecord.id === store.activeContractId ? ' af-active' : ''));
                pill.type = 'button';
                pill.appendChild(h('span', 'af-contract-pill-name', contractRecord.name));
                pill.appendChild(h('span', 'af-contract-pill-file', contractRecord.fileName || 'openapi'));
                mxEvent.addListener(pill, 'click', function()
                {
                    store.activeContractId = contractRecord.id;
                    saveStore('Contrato seleccionado');
                    render();
                });
                library.appendChild(pill);
            })(contracts[contractIndex]);
        }

        contractContent.appendChild(library);

        var contractRecord = activeContract();
        var contract = contractRecord.document || {};

        var info = contract.info || {};
        var apiInfo = h('div', 'af-api-info');
        apiInfo.appendChild(h('div', 'af-api-title', info.title || contractRecord.name));
        apiInfo.appendChild(h('div', 'af-api-meta', (contract.openapi ? 'OpenAPI ' + contract.openapi : 'Swagger ' + contract.swagger) +
            (info.version ? ' · versión ' + info.version : '')));
        if (contract.servers != null && contract.servers.length > 0)
        {
            apiInfo.appendChild(h('div', 'af-api-server', contract.servers[0].url));
        }
        else if (contract.host != null)
        {
            apiInfo.appendChild(h('div', 'af-api-server', (contract.schemes && contract.schemes[0] ? contract.schemes[0] + '://' : '') + contract.host + (contract.basePath || '')));
        }
        contractContent.appendChild(apiInfo);

        var operations = contractOperations(contract);
        var groups = {};
        var order = [];
        for (var i = 0; i < operations.length; i++)
        {
            if (groups[operations[i].tag] == null)
            {
                groups[operations[i].tag] = [];
                order.push(operations[i].tag);
            }
            groups[operations[i].tag].push(operations[i]);
        }

        for (var j = 0; j < order.length; j++)
        {
            contractContent.appendChild(h('div', 'af-tag', order[j]));
            for (var k = 0; k < groups[order[j]].length; k++)
            {
                renderSwaggerOperation(contractContent, groups[order[j]][k], contractRecord);
            }
        }
    }

    function renderPanelMode()
    {
        var contractActive = panelMode === 'contract';
        var playbackActive = !contractActive && playing;
        panel.classList.toggle('af-playback-mode', playbackActive);
        contractNavButton.classList.toggle('af-active', contractActive);
        flowNavButton.classList.toggle('af-active', !contractActive);
        contractTools.style.display = contractActive ? '' : 'none';
        contractContent.style.display = contractActive ? '' : 'none';
        flowbar.style.display = contractActive || playbackActive ? 'none' : 'grid';
        stepsStrip.style.display = contractActive || playbackActive ? 'none' : 'flex';
        stepActions.style.display = contractActive || playbackActive || activeFlow().steps.length === 0 ? 'none' : 'grid';
        content.style.display = contractActive ? 'none' : '';
    }

    function render()
    {
        renderPanelMode();

        if (panelMode === 'contract')
        {
            renderContract();
            renderToolbarState();
            return;
        }

        renderFlowOptions();
        renderSteps();
        var steps = activeFlow().steps;

        if (steps.length === 0)
        {
            content.innerHTML = '';
            content.appendChild(h('div', 'af-empty', 'Crea un flujo haciendo clic en los componentes. Las flechas se detectan automáticamente.'));
        }
        else
        {
            selectedStep = Math.max(0, Math.min(selectedStep, steps.length - 1));
            if (playing)
            {
                renderLive(steps[selectedStep]);
            }
            else
            {
                renderEditor(steps[selectedStep]);
            }
        }

        renderToolbarState();
    }

    function valueNode(label, kind)
    {
        var doc = mxUtils.createXmlDocument();
        var node = doc.createElement('object');
        node.setAttribute('label', label);
        node.setAttribute('archiflowKind', kind);
        return node;
    }

    function demoStep(cell, edge, responseEdge, values)
    {
        var step = emptyStep(cell.id, edge != null ? edge.id : null,
            responseEdge != null ? responseEdge.id : null);
        for (var key in values)
        {
            step[key] = values[key];
        }
        return step;
    }

    function createDemo()
    {
        var parent = graph.getDefaultParent();
        var existing = graph.getChildVertices(parent);

        if (existing.length > 0)
        {
            return;
        }

        model.beginUpdate();
        try
        {
            var title = graph.insertVertex(parent, null, valueNode('UML · Endpoints entre microservicios', 'title'), 55, 25, 570, 42,
                'text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=24;fontStyle=1;fontColor=#111827;');
            graph.setAttributeForCell(title, 'archiflowSelectable', '0');

            var componentStyle = 'shape=component;whiteSpace=wrap;html=1;container=1;recursiveResize=0;collapsible=0;align=left;verticalAlign=top;spacingTop=18;spacingLeft=18;fontSize=19;fontStyle=1;fillColor=#f8fafc;strokeColor=#475569;strokeWidth=2;';
            var serviceA = graph.insertVertex(parent, null,
                valueNode('«component»<br>ms-clientes<br><font color="#64748b" style="font-size:11px;font-weight:normal">Java · REST API</font>', 'uml-component'),
                70, 105, 390, 390, componentStyle + 'fillColor=#eff6ff;strokeColor=#3b82f6;');
            var serviceB = graph.insertVertex(parent, null,
                valueNode('«component»<br>ms-riesgo<br><font color="#64748b" style="font-size:11px;font-weight:normal">Quarkus · REST API</font>', 'uml-component'),
                760, 105, 390, 390, componentStyle + 'fillColor=#ecfdf5;strokeColor=#10b981;');
            graph.setAttributeForCell(serviceA, 'archiflowSelectable', '0');
            graph.setAttributeForCell(serviceB, 'archiflowSelectable', '0');

            var endpointStyle = 'rounded=1;whiteSpace=wrap;html=1;arcSize=12;strokeWidth=2;fontSize=13;fontStyle=1;align=left;spacingLeft=14;verticalAlign=middle;';
            var clientesGet = graph.insertVertex(serviceA, null,
                valueNode('GET /v1/clientes/{id}<br><font color="#64748b" style="font-size:10px;font-weight:normal">Consultar cliente</font>', 'endpoint'),
                38, 115, 305, 82, endpointStyle + 'fillColor=#dbeafe;strokeColor=#3b82f6;');
            var clientesValidar = graph.insertVertex(serviceA, null,
                valueNode('POST /v1/clientes/validar<br><font color="#64748b" style="font-size:10px;font-weight:normal">Validar elegibilidad</font>', 'endpoint'),
                38, 250, 305, 82, endpointStyle + 'fillColor=#dbeafe;strokeColor=#3b82f6;');
            var riesgoPerfil = graph.insertVertex(serviceB, null,
                valueNode('GET /internal/perfil/{id}<br><font color="#64748b" style="font-size:10px;font-weight:normal">Obtener perfil de riesgo</font>', 'endpoint'),
                47, 115, 305, 82, endpointStyle + 'fillColor=#d1fae5;strokeColor=#10b981;');
            var riesgoEvaluar = graph.insertVertex(serviceB, null,
                valueNode('POST /internal/evaluaciones<br><font color="#64748b" style="font-size:10px;font-weight:normal">Evaluar solicitud</font>', 'endpoint'),
                47, 250, 305, 82, endpointStyle + 'fillColor=#d1fae5;strokeColor=#10b981;');

            var clientesContract = {
                openapi: '3.0.3',
                info: { title: 'Clientes API', version: '1.4.0', description: 'Contrato público de ms-clientes.' },
                servers: [{ url: 'https://api.demo.local/ms-clientes' }],
                paths: {
                    '/v1/clientes/{id}': {
                        get: {
                            tags: ['Clientes'], operationId: 'consultarCliente', summary: 'Consultar cliente',
                            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                            responses: {
                                '200': { description: 'Cliente encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Cliente' } } } },
                                '404': { description: 'Cliente no encontrado' }
                            }
                        }
                    },
                    '/v1/clientes/validar': {
                        post: {
                            tags: ['Validaciones'], operationId: 'validarCliente', summary: 'Validar elegibilidad',
                            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SolicitudValidacion' } } } },
                            responses: {
                                '200': { description: 'Validación completada', content: { 'application/json': { schema: { $ref: '#/components/schemas/ResultadoValidacion' } } } },
                                '422': { description: 'Solicitud no procesable' }
                            }
                        }
                    }
                }
            };
            var riesgoContract = {
                openapi: '3.0.3',
                info: { title: 'Riesgo Internal API', version: '2.1.0', description: 'Contrato interno de ms-riesgo.' },
                servers: [{ url: 'http://ms-riesgo.internal' }],
                paths: {
                    '/internal/perfil/{id}': {
                        get: {
                            tags: ['Perfil de riesgo'], operationId: 'obtenerPerfilRiesgo', summary: 'Obtener perfil de riesgo',
                            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                            responses: { '200': { description: 'Perfil calculado', content: { 'application/json': { schema: { $ref: '#/components/schemas/PerfilRiesgo' } } } } }
                        }
                    },
                    '/internal/evaluaciones': {
                        post: {
                            tags: ['Evaluaciones'], operationId: 'evaluarSolicitud', summary: 'Evaluar solicitud',
                            requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/EvaluacionRequest' } } } },
                            responses: { '200': { description: 'Evaluación completada', content: { 'application/json': { schema: { $ref: '#/components/schemas/EvaluacionResponse' } } } } }
                        }
                    }
                }
            };
            var demoEndpoints = [
                [clientesGet, 'contract-clientes', 'GET', '/v1/clientes/{id}', 'consultarCliente', 'Consultar cliente'],
                [clientesValidar, 'contract-clientes', 'POST', '/v1/clientes/validar', 'validarCliente', 'Validar elegibilidad'],
                [riesgoPerfil, 'contract-riesgo', 'GET', '/internal/perfil/{id}', 'obtenerPerfilRiesgo', 'Obtener perfil de riesgo'],
                [riesgoEvaluar, 'contract-riesgo', 'POST', '/internal/evaluaciones', 'evaluarSolicitud', 'Evaluar solicitud']
            ];
            for (var endpointIndex = 0; endpointIndex < demoEndpoints.length; endpointIndex++)
            {
                setCellBindings(demoEndpoints[endpointIndex][0], [{
                    contractId: demoEndpoints[endpointIndex][1],
                    method: demoEndpoints[endpointIndex][2],
                    path: demoEndpoints[endpointIndex][3],
                    operationId: demoEndpoints[endpointIndex][4],
                    summary: demoEndpoints[endpointIndex][5]
                }]);
            }

            var requestStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=3;fontSize=11;fontStyle=1;labelBackgroundColor=#ffffff;strokeColor=#4f46e5;exitX=1;exitY=.34;entryX=0;entryY=.34;';
            var responseStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=block;endFill=1;strokeWidth=3;fontSize=11;fontStyle=1;labelBackgroundColor=#ffffff;strokeColor=#10b981;exitX=0;exitY=.72;entryX=1;entryY=.72;';
            var reqPerfil = graph.insertEdge(parent, null, 'REQUEST · GET perfil', clientesGet, riesgoPerfil, requestStyle);
            var resPerfil = graph.insertEdge(parent, null, 'RESPONSE · 200 OK', riesgoPerfil, clientesGet, responseStyle);
            var reqEvaluar = graph.insertEdge(parent, null, 'REQUEST · POST evaluación', clientesValidar, riesgoEvaluar, requestStyle);
            var resEvaluar = graph.insertEdge(parent, null, 'RESPONSE · 200 OK', riesgoEvaluar, clientesValidar, responseStyle);

            var flow = { id: 'uml-endpoints', name: 'UML · endpoints entre microservicios', steps: [] };
            flow.steps.push(demoStep(clientesGet, null, null, {
                operation: 'GET /v1/clientes/{id}', protocol: 'HTTPS', purpose: 'Consultar el cliente y enriquecerlo con su perfil de riesgo.',
                pathParams: 'id=cli-1029', requestHeaders: 'Authorization: Bearer •••\nX-Correlation-Id: uml-demo-001',
                responseStatus: '200 OK', responseHeaders: 'Content-Type: application/json',
                responseBody: '{"id":"cli-1029","nombre":"Cliente Demo","riesgo":"BAJO"}'
            }));
            flow.steps.push(demoStep(riesgoPerfil, reqPerfil, resPerfil, {
                operation: 'GET /internal/perfil/{id}', protocol: 'REST', purpose: 'Obtener el perfil de riesgo para el endpoint de consulta.',
                pathParams: 'id=cli-1029', requestHeaders: 'X-Correlation-Id: uml-demo-001\nX-Service: ms-clientes',
                responseStatus: '200 OK', responseHeaders: 'Content-Type: application/json', responseBody: '{"nivel":"BAJO","score":87}',
                notes: 'Llamada síncrona entre microservicios.'
            }));
            flow.steps.push(demoStep(clientesValidar, null, null, {
                operation: 'POST /v1/clientes/validar', protocol: 'HTTPS', purpose: 'Validar la elegibilidad de una solicitud.',
                requestHeaders: 'Authorization: Bearer •••\nContent-Type: application/json\nX-Correlation-Id: uml-demo-002',
                requestBody: '{"clienteId":"cli-1029","producto":"CREDITO"}', responseStatus: '200 OK',
                responseBody: '{"elegible":true,"motivo":"RIESGO_ACEPTABLE"}'
            }));
            flow.steps.push(demoStep(riesgoEvaluar, reqEvaluar, resEvaluar, {
                operation: 'POST /internal/evaluaciones', protocol: 'REST', purpose: 'Evaluar el riesgo de la solicitud recibida.',
                requestHeaders: 'Content-Type: application/json\nX-Correlation-Id: uml-demo-002\nX-Service: ms-clientes',
                requestBody: '{"clienteId":"cli-1029","producto":"CREDITO"}', responseStatus: '200 OK',
                responseHeaders: 'Content-Type: application/json', responseBody: '{"aprobado":true,"score":87}',
                notes: 'La respuesta vuelve por una conexión UML explícita.'
            }));

            store = {
                version: 2,
                activeFlowId: flow.id,
                flows: [flow],
                activeContractId: 'contract-clientes',
                contracts: [
                    { id: 'contract-clientes', name: 'Clientes API', fileName: 'clientes-api.yaml', document: clientesContract },
                    { id: 'contract-riesgo', name: 'Riesgo Internal API', fileName: 'riesgo-api.yaml', document: riesgoContract }
                ]
            };
            selectedContractCellId = clientesGet.id;
            graph.setAttributeForCell(model.getRoot(), STORE_ATTRIBUTE, JSON.stringify(store));
        }
        finally
        {
            model.endUpdate();
        }

        normalizeDemoEdges();
        ui.editor.modified = false;
        graph.fit(20);
        selectedStep = 0;
        refreshBadges();
        render();
        toast('Demo UML con endpoints cargada');
    }

    graph.addListener(mxEvent.ROOT, function()
    {
        stopPlayback();
        flowHistory = {};
        loadStore();
        refreshBadges();
        render();
    });

    loadStore();
    render();

    if (urlParams.archiflowDemo === '1')
    {
        window.setTimeout(function()
        {
            createDemo();
            normalizeDemoEdges();
            graph.refresh();
        }, 650);
    }
});
