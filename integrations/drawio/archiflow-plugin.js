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
    var STEP_DELAY = 520;
    var PARTICLE_DURATION = 1050;
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
    var highlights = [];
    var badges = [];
    var panelMode = 'contract';
    var selectedContractComponentId = null;

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
        return { version: 1, activeFlowId: flow.id, flows: [flow] };
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

        return null;
    }

    function setOpacity(cell, value)
    {
        var state = graph.view.getState(cell);

        if (state != null)
        {
            if (state.shape != null && state.shape.node != null)
            {
                state.shape.node.style.opacity = value;
            }

            if (state.text != null && state.text.node != null)
            {
                state.text.node.style.opacity = value;
            }
        }
    }

    function restoreCanvas()
    {
        for (var id in model.cells)
        {
            if (Object.prototype.hasOwnProperty.call(model.cells, id))
            {
                setOpacity(model.cells[id], '');
            }
        }

        for (var i = 0; i < highlights.length; i++)
        {
            highlights[i].destroy();
        }

        highlights = [];

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

        if (model.getTerminal(edge, true) !== fromCell)
        {
            points.reverse();
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

    function animateParticle(edge, fromCell, phase, done)
    {
        removeParticles();
        var points = routePoints(edge, fromCell);

        if (points.length < 2)
        {
            done();
            return;
        }

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

            var progress = Math.min(1, (now - started) / PARTICLE_DURATION);

            for (var j = 0; j < particles.length; j++)
            {
                var dotProgress = Math.max(0, progress - j * .045);
                var point = pointOnRoute(points, dotProgress);

                if (point != null)
                {
                    particles[j].style.left = point.x + 'px';
                    particles[j].style.top = point.y + 'px';
                    particles[j].style.opacity = progress < j * .045 ? '0' : String(1 - j * .27);
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

    function loadGifEncoder()
    {
        if (window.ArchiFlowGif != null)
        {
            return Promise.resolve(window.ArchiFlowGif);
        }

        return new Promise(function(resolve, reject)
        {
            var existing = document.querySelector('script[data-archiflow-gif]');
            var script = existing || document.createElement('script');
            script.onload = function() { resolve(window.ArchiFlowGif); };
            script.onerror = function() { reject(new Error('No se pudo cargar el codificador GIF.')); };

            if (existing == null)
            {
                script.src = '/archiflow-gif.js';
                script.setAttribute('data-archiflow-gif', '1');
                document.head.appendChild(script);
            }
        });
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

    function svgFrame(movement, progress)
    {
        var border = 18;
        var bounds = graph.getGraphBounds();
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        var width = Math.max(1, Math.ceil(bounds.width + border * 2));
        var height = Math.max(1, Math.ceil(bounds.height + border * 2));
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        var background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.setAttribute('width', '100%');
        background.setAttribute('height', '100%');
        background.setAttribute('fill', '#ffffff');
        svg.appendChild(background);

        function sx(value) { return value - bounds.x + border; }
        function sy(value) { return value - bounds.y + border; }

        for (var edgeId in model.cells)
        {
            var edgeCell = model.cells[edgeId];
            if (edgeCell == null || !model.isEdge(edgeCell) || !graph.isCellVisible(edgeCell)) continue;
            var edgeState = graph.view.getState(edgeCell);
            if (edgeState == null || edgeState.absolutePoints == null) continue;
            var commands = [];
            for (var edgePointIndex = 0; edgePointIndex < edgeState.absolutePoints.length; edgePointIndex++)
            {
                var edgePoint = edgeState.absolutePoints[edgePointIndex];
                if (edgePoint != null) commands.push((commands.length === 0 ? 'M ' : 'L ') + sx(edgePoint.x) + ' ' + sy(edgePoint.y));
            }
            if (commands.length < 2) continue;
            var edgePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            var edgeStyleValues = graph.getCellStyle(edgeCell);
            edgePath.setAttribute('d', commands.join(' '));
            edgePath.setAttribute('fill', 'none');
            edgePath.setAttribute('stroke', edgeStyleValues[mxConstants.STYLE_STROKECOLOR] || '#64748b');
            edgePath.setAttribute('stroke-width', edgeCell === movement.edge ? '4' : '2');
            edgePath.setAttribute('stroke-linecap', 'round');
            edgePath.setAttribute('stroke-linejoin', 'round');
            if (edgeStyleValues[mxConstants.STYLE_DASHED] === '1') edgePath.setAttribute('stroke-dasharray', '7 5');
            svg.appendChild(edgePath);
        }

        for (var vertexId in model.cells)
        {
            var vertexCell = model.cells[vertexId];
            if (vertexCell == null || !model.isVertex(vertexCell) || !graph.isCellVisible(vertexCell)) continue;
            var vertexState = graph.view.getState(vertexCell);
            if (vertexState == null || vertexState.width < 6 || vertexState.height < 6) continue;
            var vertexStyleValues = graph.getCellStyle(vertexCell);
            var rectangle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rectangle.setAttribute('x', String(sx(vertexState.x)));
            rectangle.setAttribute('y', String(sy(vertexState.y)));
            rectangle.setAttribute('width', String(vertexState.width));
            rectangle.setAttribute('height', String(vertexState.height));
            rectangle.setAttribute('rx', '8');
            rectangle.setAttribute('fill', vertexStyleValues[mxConstants.STYLE_FILLCOLOR] || '#ffffff');
            rectangle.setAttribute('stroke', vertexStyleValues[mxConstants.STYLE_STROKECOLOR] || '#94a3b8');
            rectangle.setAttribute('stroke-width', '2');
            svg.appendChild(rectangle);

            var vertexLabel = labelFor(vertexCell);
            if (vertexLabel !== '')
            {
                var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', String(sx(vertexState.x) + 9));
                text.setAttribute('y', String(sy(vertexState.y) + Math.min(22, vertexState.height / 2 + 4)));
                text.setAttribute('fill', vertexStyleValues[mxConstants.STYLE_FONTCOLOR] || '#0f172a');
                text.setAttribute('font-family', 'Arial, sans-serif');
                text.setAttribute('font-size', vertexState.height < 55 ? '10' : '12');
                text.setAttribute('font-weight', '600');
                text.textContent = vertexLabel.length > 58 ? vertexLabel.slice(0, 55) + '…' : vertexLabel;
                svg.appendChild(text);
            }
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
            circle.setAttribute('r', i === 0 ? '8' : String(5 - i));
            circle.setAttribute('fill', color);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', i === 0 ? '3' : '1.5');
            circle.setAttribute('opacity', String(1 - i * .28));
            overlay.appendChild(circle);
        }

        var point = pointOnRoute(points, progress);
        if (point != null)
        {
            var badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            badge.setAttribute('x', String(sx(point.x) + 13));
            badge.setAttribute('y', String(sy(point.y) - 10));
            badge.setAttribute('fill', color);
            badge.setAttribute('font-family', 'Arial, sans-serif');
            badge.setAttribute('font-size', '11');
            badge.setAttribute('font-weight', '700');
            badge.textContent = label;
            overlay.appendChild(badge);
        }

        svg.appendChild(overlay);
        return svg;
    }

    function rasterizeSvg(svg)
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
                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);
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

    async function exportActiveFlowGif()
    {
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
            var encoder = await loadGifEncoder();
            var frames = [];
            var dimensions = null;
            var samples = movements.length > 10 ? 4 : 7;
            var total = movements.length * samples;

            for (var i = 0; i < movements.length; i++)
            {
                for (var frame = 0; frame < samples; frame++)
                {
                    gifButton.textContent = 'GIF ' + (frames.length + 1) + '/' + total;
                    await new Promise(function(resolve) { window.setTimeout(resolve, 0); });
                    dimensions = await rasterizeSvg(svgFrame(movements[i], frame / (samples - 1)));
                    frames.push({ data: dimensions.data });
                }
            }

            var palette = encoder.buildPalette('#ffffff', ['#0f172a', '#475569', '#6366f1', '#10b981', '#ef4444', '#ffffff']);
            var bytes = encoder.encodeGif(frames, palette, { width: dimensions.width, height: dimensions.height, delayMs: 150 });
            var download = document.createElement('a');
            var blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
            download.href = blobUrl;
            download.download = (flow.name || 'archiflow').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() + '.gif';
            document.body.appendChild(download);
            download.click();
            document.body.removeChild(download);
            window.setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 30000);
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

    var style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = [
        '.geFormatContainer.af-native-mode{width:370px}',
        '#af-toolbar{display:inline-flex;vertical-align:top;align-items:center;gap:3px;height:30px;margin:4px 0 0 8px;padding-left:9px;border-left:1px solid light-dark(#d1d5db,#4b5563);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '#af-toolbar .af-brand{font-weight:700;padding:0 7px 0 2px;color:light-dark(#3730a3,#c7d2fe);letter-spacing:.15px}',
        '.af-btn{min-width:28px;height:28px;border:1px solid transparent;border-radius:5px;padding:3px 7px;background:transparent;color:light-dark(#374151,#e5e7eb);font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;white-space:nowrap}',
        '.af-btn:hover{background:light-dark(#e5e7eb,#374151)}.af-btn:disabled{opacity:.38;cursor:default}',
        '.af-btn-primary{background:light-dark(#e0e7ff,#3730a3);color:light-dark(#3730a3,#eef2ff)}.af-btn-danger{color:light-dark(#b91c1c,#fca5a5)}.af-btn-ghost{color:light-dark(#475569,#cbd5e1)}',
        '#af-panel{position:static;width:100%;min-height:100%;background:light-dark(#f8fafc,#1b1d1e);color:light-dark(#0f172a,#e5e7eb);border:0;box-shadow:none;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:visible;display:block;margin:0;padding:0}',
        '#af-panel *{box-sizing:border-box}',
        '.af-panel-head{padding:14px 15px 12px;background:light-dark(#eef2ff,#242447);border-bottom:1px solid light-dark(#dbeafe,#3f3f69);color:light-dark(#111827,#f8fafc)}',
        '.af-eyebrow{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:light-dark(#4f46e5,#a5b4fc);margin-bottom:4px}',
        '.af-panel-title{font-size:17px;font-weight:700;line-height:1.25}.af-panel-sub{font-size:11px;color:light-dark(#64748b,#cbd5e1);margin-top:4px;line-height:1.35}',
        '.af-panel-nav{display:grid;grid-template-columns:1fr 1fr;padding:9px 11px 0;background:light-dark(#fff,#1b1d1e);gap:5px}.af-nav-btn{border:0;border-bottom:3px solid transparent;padding:8px 6px;background:transparent;color:light-dark(#64748b,#9ca3af);font-size:11px;font-weight:800;cursor:pointer}.af-nav-btn.af-active{border-bottom-color:#6366f1;color:light-dark(#3730a3,#c7d2fe)}',
        '.af-contract-tools{display:flex;gap:7px;align-items:center;padding:10px 12px;background:light-dark(#fff,#1b1d1e);border-bottom:1px solid light-dark(#e2e8f0,#333)}.af-import-btn{flex:0 0 auto;border:0;border-radius:7px;padding:8px 10px;background:#6366f1;color:#fff;font-size:11px;font-weight:750;cursor:pointer}.af-contract-target{min-width:0;font-size:10px;color:light-dark(#64748b,#9ca3af);line-height:1.3;overflow:hidden;text-overflow:ellipsis}.af-contract-content{padding:12px 12px 30px}.af-contract-empty{border:1px dashed light-dark(#94a3b8,#4b5563);border-radius:10px;padding:18px 12px;text-align:center;color:light-dark(#64748b,#9ca3af);font-size:11px;line-height:1.5}.af-api-info{padding:12px;border-radius:11px;background:light-dark(#eef2ff,#272542);border:1px solid light-dark(#c7d2fe,#433f69);margin-bottom:12px}.af-api-title{font-size:17px;font-weight:800}.af-api-meta{font-size:10px;color:light-dark(#64748b,#a5b4fc);margin-top:4px}.af-api-server{font:10px/1.35 Consolas,monospace;margin-top:7px;word-break:break-all;color:light-dark(#334155,#cbd5e1)}',
        '.af-tag{margin:13px 0 7px;font-size:12px;font-weight:850;color:light-dark(#334155,#e2e8f0);display:flex;align-items:center;gap:6px}.af-tag:before{content:"";width:5px;height:15px;border-radius:4px;background:#6366f1}.af-operation{display:block;border:1px solid var(--af-method);border-radius:8px;margin-bottom:8px;background:color-mix(in srgb,var(--af-method) 8%,transparent);overflow:hidden}.af-operation summary{list-style:none;display:grid;grid-template-columns:50px minmax(0,1fr);gap:8px;align-items:center;padding:8px;cursor:pointer}.af-operation summary::-webkit-details-marker{display:none}.af-method{border-radius:5px;padding:5px 3px;background:var(--af-method);color:#fff;text-align:center;font:800 10px Arial,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.15)}.af-operation-path{min-width:0;font:700 11px/1.3 Consolas,monospace;word-break:break-word}.af-operation-summary{grid-column:2;font-size:10px;color:light-dark(#64748b,#9ca3af);margin-top:-4px}.af-operation-body{padding:0 9px 10px;border-top:1px solid color-mix(in srgb,var(--af-method) 35%,transparent)}.af-swagger-label{font-size:9px;font-weight:850;letter-spacing:.55px;text-transform:uppercase;color:light-dark(#64748b,#9ca3af);margin:9px 0 4px}.af-swagger-row{font-size:10px;line-height:1.4;padding:5px 7px;border-radius:5px;background:light-dark(#fff,#17191c);margin:3px 0;word-break:break-word}.af-status{display:inline-block;min-width:34px;margin-right:6px;font-family:Consolas,monospace;font-weight:800;color:#10b981}.af-schema{font-family:Consolas,monospace;color:light-dark(#475569,#cbd5e1)}',
        '.af-flowbar{padding:10px 12px;background:light-dark(#fff,#1b1d1e);border-bottom:1px solid light-dark(#e2e8f0,#333);display:flex;gap:6px}',
        '.af-flowbar select,.af-flowbar input{min-width:0;flex:1;border:1px solid light-dark(#cbd5e1,#48484a);border-radius:6px;padding:7px;background:light-dark(#fff,#1c1c1e);color:light-dark(#0f172a,#e5e7eb)}',
        '.af-steps{padding:9px 11px;background:light-dark(#f5f7ff,#202036);border-bottom:1px solid light-dark(#dbeafe,#333);display:flex;gap:6px;overflow-x:auto;min-height:54px}',
        '.af-step-chip{flex:0 0 auto;border:1px solid light-dark(#c7d2fe,#4b4b78);background:light-dark(#fff,#2c2c3d);color:inherit;border-radius:7px;padding:6px 8px;cursor:pointer;max-width:145px}',
        '.af-step-chip.af-active{border-color:#4f46e5;box-shadow:0 0 0 2px rgba(99,102,241,.16)}',
        '.af-step-no{font-weight:800;color:#4f46e5;margin-right:4px}.af-step-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:bottom;max-width:105px}',
        '.af-step-actions{display:flex;align-items:center;gap:5px;padding:7px 11px;background:light-dark(#fff,#1b1d1e);border-bottom:1px solid light-dark(#e2e8f0,#333);overflow-x:auto}.af-step-action{flex:0 0 auto;border:1px solid light-dark(#cbd5e1,#475569);border-radius:6px;padding:5px 7px;background:light-dark(#fff,#25272b);color:inherit;font-size:10px;font-weight:750;cursor:pointer;white-space:nowrap}.af-step-action:hover{border-color:#6366f1}.af-step-action:disabled{opacity:.35;cursor:default}.af-step-action-danger{color:#dc2626;border-color:light-dark(#fecaca,#7f1d1d)}',
        '.af-content{padding:13px 14px 28px;overflow:visible}.af-empty{padding:28px 14px;text-align:center;color:light-dark(#64748b,#a0a0a0);line-height:1.5}',
        '.af-kicker{font-size:11px;color:#6366f1;font-weight:800;text-transform:uppercase;letter-spacing:.8px}.af-object{font-size:20px;font-weight:750;margin:3px 0 12px}',
        '.af-section{border-top:1px solid light-dark(#e2e8f0,#333);padding-top:12px;margin-top:12px}.af-section-title{font-size:11px;font-weight:800;letter-spacing:.65px;text-transform:uppercase;color:light-dark(#475569,#cbd5e1);margin-bottom:9px}',
        '.af-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.af-field{display:block;margin-bottom:9px}.af-field span{display:block;font-size:11px;font-weight:700;color:light-dark(#475569,#cbd5e1);margin-bottom:5px}',
        '.af-field input,.af-field textarea,.af-field select{width:100%;border:1px solid light-dark(#cbd5e1,#48484a);border-radius:6px;padding:8px 9px;background:light-dark(#fff,#1c1c1e);color:light-dark(#0f172a,#e5e7eb);font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
        '.af-field textarea{min-height:58px;resize:vertical;font-family:Consolas,monospace;font-size:11px;line-height:1.4}',
        '.af-live{background:#0f172a;color:#e2e8f0;border-radius:10px;padding:10px 11px;margin-top:8px;white-space:pre-wrap;word-break:break-word;font:11px/1.45 Consolas,monospace}',
        '.af-live-label{font-size:10px;text-transform:uppercase;letter-spacing:.65px;color:#94a3b8;margin:10px 0 4px}.af-live-label:first-child{margin-top:0}',
        '.af-roundtrip{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:10px 0 12px}.af-phase{border:1px solid light-dark(#cbd5e1,#475569);border-radius:9px;padding:8px 9px;font-size:10px;font-weight:800;letter-spacing:.55px;text-transform:uppercase;background:light-dark(#fff,#25272b);color:light-dark(#64748b,#94a3b8)}',
        '.af-phase-request.af-current{border-color:#6366f1;background:light-dark(#eef2ff,#312e81);color:light-dark(#3730a3,#e0e7ff);box-shadow:0 0 0 2px rgba(99,102,241,.12)}.af-phase-response.af-current{border-color:#10b981;background:light-dark(#ecfdf5,#064e3b);color:light-dark(#047857,#d1fae5);box-shadow:0 0 0 2px rgba(16,185,129,.12)}',
        '.af-live-card{border:1px solid light-dark(#dbe2ea,#374151);border-radius:11px;padding:10px;margin-top:9px;background:light-dark(#fff,#202226)}.af-live-card.af-current-request{border-color:#818cf8}.af-live-card.af-current-response{border-color:#34d399}.af-live-card-title{font-size:10px;font-weight:850;letter-spacing:.7px;text-transform:uppercase;margin-bottom:7px}.af-live-card-request .af-live-card-title{color:#6366f1}.af-live-card-response .af-live-card-title{color:#10b981}.af-live-empty{font-size:11px;color:light-dark(#94a3b8,#9ca3af);font-style:italic}',
        '.af-flow-particle{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;pointer-events:none;z-index:10025;box-sizing:border-box}.af-particle-request{background:#6366f1;border:2px solid #fff;box-shadow:0 0 0 4px rgba(99,102,241,.2),0 0 15px rgba(99,102,241,.9)}.af-particle-response{background:#10b981;border:2px solid #fff;box-shadow:0 0 0 4px rgba(16,185,129,.2),0 0 15px rgba(16,185,129,.9)}.af-particle-trail{width:8px;height:8px;margin:-4px 0 0 -4px;border-width:1px}.af-particle-head:after{content:attr(data-label);position:absolute;left:17px;top:-5px;padding:2px 4px;border-radius:4px;background:#0f172a;color:#fff;font:700 9px/1.2 Arial,sans-serif;letter-spacing:.3px;box-shadow:0 2px 5px rgba(0,0,0,.25)}',
        '.af-recording{animation:afPulse 1.1s ease-in-out infinite;background:#ef4444!important;color:#fff!important}@keyframes afPulse{50%{opacity:.65}}',
        '.af-toast{position:fixed;left:50%;top:100px;transform:translateX(-50%);z-index:10030;padding:10px 14px;border-radius:9px;background:#111827;color:#fff;font:600 12px Arial,sans-serif;box-shadow:0 8px 25px rgba(0,0,0,.25)}'
    ].join('\n');
    document.head.appendChild(style);

    var toolbar = h('div');
    toolbar.id = 'af-toolbar';
    toolbar.appendChild(h('span', 'af-brand', 'ArchiFlow'));
    var recordButton = makeButton('●', 'af-btn-primary', toggleRecording);
    recordButton.title = 'Grabar un flujo nuevo sin modificar los anteriores';
    recordButton.setAttribute('aria-label', 'Grabar recorrido');
    var playButton = makeButton('▶', '', function() { playFlow(0); });
    playButton.title = 'Reproducir flujo';
    playButton.setAttribute('aria-label', 'Reproducir flujo');
    var stopButton = makeButton('■', 'af-btn-danger', stopPlayback);
    stopButton.title = 'Detener animación';
    stopButton.setAttribute('aria-label', 'Detener animación');
    var undoButton = makeButton('↶', 'af-btn-ghost', undoLastStep);
    undoButton.title = 'Eliminar último paso';
    undoButton.setAttribute('aria-label', 'Eliminar último paso');
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
    panelHead.appendChild(h('div', 'af-panel-sub', 'Request, response, parámetros, headers, caché y persistencia por paso.'));
    panel.appendChild(panelHead);
    var panelNav = h('div', 'af-panel-nav');
    var contractNavButton = h('button', 'af-nav-btn af-active', 'Contrato API');
    contractNavButton.type = 'button';
    var flowNavButton = h('button', 'af-nav-btn', 'Flujo animado');
    flowNavButton.type = 'button';
    panelNav.appendChild(contractNavButton);
    panelNav.appendChild(flowNavButton);
    panel.appendChild(panelNav);
    var contractTools = h('div', 'af-contract-tools');
    var importContractButton = h('button', 'af-import-btn', 'Importar OpenAPI');
    importContractButton.type = 'button';
    importContractButton.title = 'Selecciona un componente UML y carga un contrato JSON, YAML o YML';
    var contractTarget = h('div', 'af-contract-target', 'Selecciona un componente');
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
        setFormatWidth(370);
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

    mxEvent.addListener(importContractButton, 'click', function()
    {
        var component = componentForCell(graph.getSelectionCell());

        if (component == null)
        {
            toast('Selecciona primero el componente UML del microservicio');
            return;
        }

        selectedContractComponentId = component.id;
        contractFile.value = '';
        contractFile.click();
    });

    mxEvent.addListener(contractFile, 'change', function()
    {
        if (contractFile.files == null || contractFile.files.length === 0)
        {
            return;
        }

        var component = model.getCell(selectedContractComponentId);
        var reader = new FileReader();
        reader.onload = function()
        {
            parseContract(String(reader.result || '')).then(function(contract)
            {
                importContract(component, contract, contractFile.files[0].name);
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

        if (method !== '' || path !== '')
        {
            step.operation = (method + ' ' + path).trim();
            step.protocol = 'REST';
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
        recordButton.title = 'Grabar un flujo nuevo';
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
            if (graph.getAttributeForCell(current, 'archiflowKind', '') === 'uml-component')
            {
                return current;
            }

            current = model.getParent(current);
        }

        return null;
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

    function importContract(component, contract, fileName)
    {
        if (component == null || contract == null || (contract.openapi == null && contract.swagger == null) || contract.paths == null)
        {
            throw new Error('El archivo no contiene un contrato OpenAPI válido.');
        }

        var operations = contractOperations(contract);

        if (operations.length === 0)
        {
            throw new Error('El contrato no contiene endpoints.');
        }

        model.beginUpdate();
        try
        {
            var children = graph.getChildVertices(component);
            var generatedByKey = {};
            var generated = [];

            for (var i = 0; i < children.length; i++)
            {
                if (graph.getAttributeForCell(children[i], 'archiflowContractEndpoint', '0') === '1')
                {
                    generated.push(children[i]);
                    generatedByKey[graph.getAttributeForCell(children[i], 'archiflowHttpMethod', '') + ' ' +
                        graph.getAttributeForCell(children[i], 'archiflowPath', '')] = children[i];
                }
            }

            graph.setAttributeForCell(component, 'archiflowOpenApi', JSON.stringify(contract));
            graph.setAttributeForCell(component, 'archiflowContractFile', fileName || 'openapi');

            var geometry = model.getGeometry(component);
            var requiredHeight = Math.max(210, 112 + operations.length * 72);

            if (geometry != null && geometry.height < requiredHeight)
            {
                var resized = geometry.clone();
                resized.height = requiredHeight;
                model.setGeometry(component, resized);
                geometry = resized;
            }

            var width = geometry != null ? geometry.width : 390;

            for (var j = 0; j < operations.length; j++)
            {
                var descriptor = operations[j];
                var color = methodColor(descriptor.method);
                var key = descriptor.method + ' ' + descriptor.path;
                var endpoint = generatedByKey[key];
                var endpointLabel = '<b>' + descriptor.method + '</b> ' + mxUtils.htmlEntities(descriptor.path) +
                    '<br><font color="#64748b" style="font-size:10px;font-weight:normal">' +
                    mxUtils.htmlEntities(descriptor.operation.summary || descriptor.operation.operationId || descriptor.tag) + '</font>';
                var endpointGeometry = new mxGeometry(32, 92 + j * 72, Math.max(210, width - 68), 56);

                if (endpoint == null)
                {
                    endpoint = graph.insertVertex(component, null, valueNode(endpointLabel, 'endpoint'),
                        endpointGeometry.x, endpointGeometry.y, endpointGeometry.width, endpointGeometry.height,
                        'rounded=1;whiteSpace=wrap;html=1;arcSize=10;strokeWidth=2;fontSize=12;align=left;spacingLeft=12;verticalAlign=middle;fillColor=#ffffff;strokeColor=' + color + ';');
                }
                else
                {
                    model.setValue(endpoint, valueNode(endpointLabel, 'endpoint'));
                    model.setGeometry(endpoint, endpointGeometry);
                    graph.setCellStyles('strokeColor', color, [endpoint]);
                    generated.splice(generated.indexOf(endpoint), 1);
                }

                graph.setAttributeForCell(endpoint, 'archiflowContractEndpoint', '1');
                graph.setAttributeForCell(endpoint, 'archiflowOperationId', descriptor.operation.operationId || descriptor.method + '-' + descriptor.path);
                graph.setAttributeForCell(endpoint, 'archiflowHttpMethod', descriptor.method);
                graph.setAttributeForCell(endpoint, 'archiflowPath', descriptor.path);
            }

            if (generated.length > 0)
            {
                graph.removeCells(generated, true);
            }
        }
        finally
        {
            model.endUpdate();
        }

        selectedContractComponentId = component.id;
        ui.editor.modified = true;
        graph.refresh(component);
        graph.scrollCellToVisible(component);
        panelMode = 'contract';
        render();
        toast(operations.length + ' endpoints importados en ' + labelFor(component));
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
            var flow = { id: uid('flow'), name: 'Nuevo flujo ' + (store.flows.length + 1), steps: [] };
            store.flows.push(flow);
            store.activeFlowId = flow.id;
            selectedStep = 0;
            saveStore('Nuevo flujo creado sin modificar los anteriores');
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
        toast('Nuevo flujo: selecciona los componentes en orden');
    }

    function undoLastStep()
    {
        var flow = activeFlow();

        if (flow.steps.length > 0)
        {
            flow.steps.pop();
            selectedStep = Math.max(0, flow.steps.length - 1);
            reconnectSteps(flow);
            saveStore('Último paso eliminado');
            refreshBadges();
            render();
        }
    }

    graph.selectionModel.addListener(mxEvent.CHANGE, function()
    {
        var selectedComponent = componentForCell(graph.getSelectionCell());

        if (selectedComponent != null)
        {
            selectedContractComponentId = selectedComponent.id;

            if (panelMode === 'contract')
            {
                render();
            }
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
            selectedStep++;
            flow.steps.splice(selectedStep, 0, stepForCell(cell));
            reconnectSteps(flow);
            saveStore('Paso insertado en la posición ' + (selectedStep + 1));
            finishRecording('Paso insertado; conexiones vecinas actualizadas');
            toast('Paso insertado sin regrabar el flujo');
            return;
        }

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
        for (var j = 0; j < highlights.length; j++) highlights[j].destroy();
        highlights = [];

        selectedStep = index;
        var step = flow.steps[index];
        playbackPhase = step.direction === 'response' ? 'response' : 'request';
        var cell = cellFor(step);
        var fromCell = sourceCellFor(step, null);
        var edge = step.edgeId != null ? model.getCell(step.edgeId) : inferEdge(fromCell, cell);

        if (cell != null)
        {
            setOpacity(cell, '1');
            var highlight = new mxCellHighlight(graph, playbackPhase === 'response' ? '#10b981' : '#6366f1', 6, true);
            highlight.highlight(graph.view.getState(cell));
            highlights.push(highlight);
            graph.scrollCellToVisible(cell);
        }
        if (fromCell != null) setOpacity(fromCell, '1');
        if (edge != null) setOpacity(edge, '1');
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

            for (var id in model.cells)
            {
                var candidate = model.cells[id];
                if (candidate != null && model.isVertex(candidate))
                {
                    setOpacity(candidate, '.18');
                }
            }

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

        for (var j = 0; j < highlights.length; j++)
        {
            highlights[j].destroy();
        }
        highlights = [];

        selectedStep = index;
        playbackPhase = phase;
        var step = flow.steps[index];
        var cell = cellFor(step);

        if (cell != null)
        {
            setOpacity(cell, '1');
            var cellHighlight = new mxCellHighlight(graph, '#6366f1', 6, true);
            cellHighlight.highlight(graph.view.getState(cell));
            highlights.push(cellHighlight);
            graph.scrollCellToVisible(cell);
        }

        var playbackEdgeId = phase === 'response' && step.responseEdgeId != null ? step.responseEdgeId : step.edgeId;
        var edge = playbackEdgeId != null ? model.getCell(playbackEdgeId) : null;

        var previousCell = index > 0 ? cellFor(flow.steps[index - 1]) : null;
        var explicitFromCell = sourceCellFor(step, previousCell);

        if (edge == null && explicitFromCell != null)
        {
            edge = inferEdge(explicitFromCell, cell);
        }

        if (edge != null && explicitFromCell != null)
        {
            setOpacity(edge, '1');
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
        recordButton.disabled = playing || exportingGif;
        playButton.disabled = playing || exportingGif;
        stopButton.disabled = !playing || exportingGif;
        gifButton.disabled = playing || exportingGif || gifMovements(activeFlow()).length === 0;
        undoButton.disabled = playing || exportingGif || recording || steps.length === 0;
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
                var chip = h('button', 'af-step-chip' + (stepIndex === selectedStep ? ' af-active' : ''));
                chip.type = 'button';
                chip.appendChild(h('span', 'af-step-no', String(stepIndex + 1)));
                chip.appendChild(h('span', 'af-step-name', labelFor(cellFor(steps[stepIndex]))));
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
            }
        });
        wrapper.appendChild(input);
        parent.appendChild(wrapper);
    }

    function section(title)
    {
        var el = h('section', 'af-section');
        el.appendChild(h('div', 'af-section-title', title));
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
        content.appendChild(h('div', 'af-kicker', (playbackPhase === 'request' ? 'Ida · Request' : 'Vuelta · Response') + ' · Paso ' + (selectedStep + 1) + ' de ' + activeFlow().steps.length));
        content.appendChild(h('div', 'af-object', labelFor(cellFor(step))));
        var phases = h('div', 'af-roundtrip');
        phases.appendChild(h('div', 'af-phase af-phase-request' + (playbackPhase === 'request' ? ' af-current' : ''), 'IDA → REQUEST'));
        phases.appendChild(h('div', 'af-phase af-phase-response' + (playbackPhase === 'response' ? ' af-current' : ''), '← VUELTA · RESPONSE'));
        content.appendChild(phases);
        liveValue(content, 'Operación', step.operation);
        liveValue(content, 'Protocolo', step.protocol);
        liveValue(content, 'Propósito', step.purpose);
        liveCard(content, 'IDA → REQUEST', 'request', playbackPhase === 'request', [
            ['Query params', step.queryParams],
            ['Path params', step.pathParams],
            ['Headers', step.requestHeaders],
            ['Body', step.requestBody]
        ]);
        liveCard(content, '← VUELTA · RESPONSE', 'response', playbackPhase === 'response', [
            ['Status', step.responseStatus],
            ['Headers', step.responseHeaders],
            ['Body', step.responseBody]
        ]);
        liveValue(content, 'Caché', [step.cacheOperation, step.cacheKey, step.cacheData, step.cacheTtl].filter(Boolean).join('\n'));
        liveValue(content, 'Notas', step.notes);
    }

    function renderEditor(step)
    {
        content.innerHTML = '';
        content.appendChild(h('div', 'af-kicker', 'Paso ' + (selectedStep + 1) + ' de ' + activeFlow().steps.length));
        content.appendChild(h('div', 'af-object', labelFor(cellFor(step))));

        var general = h('div');
        var generalGrid = h('div', 'af-grid');
        addField(generalGrid, 'Operación', 'operation', step.operation, false);
        addField(generalGrid, 'Protocolo', 'protocol', step.protocol, false, ['HTTPS', 'HTTP', 'REST', 'gRPC', 'Redis', 'SQL', 'Kafka', 'AMQP', 'Interno']);
        general.appendChild(generalGrid);
        addField(general, 'Propósito', 'purpose', step.purpose, false);
        content.appendChild(general);

        var request = section('IDA → REQUEST');
        var params = h('div', 'af-grid');
        addField(params, 'Query params', 'queryParams', step.queryParams, true);
        addField(params, 'Path params', 'pathParams', step.pathParams, true);
        request.appendChild(params);
        addField(request, 'Headers', 'requestHeaders', step.requestHeaders, true);
        addField(request, 'Body', 'requestBody', step.requestBody, true);
        content.appendChild(request);

        var response = section('← VUELTA · RESPONSE');
        addField(response, 'Status', 'responseStatus', step.responseStatus, false);
        addField(response, 'Headers', 'responseHeaders', step.responseHeaders, true);
        addField(response, 'Body', 'responseBody', step.responseBody, true);
        content.appendChild(response);

        var cache = section('Caché y persistencia');
        var cacheGrid = h('div', 'af-grid');
        addField(cacheGrid, 'Operación', 'cacheOperation', step.cacheOperation, false);
        addField(cacheGrid, 'TTL', 'cacheTtl', step.cacheTtl, false);
        cache.appendChild(cacheGrid);
        addField(cache, 'Clave / recurso', 'cacheKey', step.cacheKey, false);
        addField(cache, 'Datos utilizados o guardados', 'cacheData', step.cacheData, true);
        content.appendChild(cache);

        var notes = section('Contexto');
        addField(notes, 'Notas', 'notes', step.notes, true);
        content.appendChild(notes);
    }

    function appendSwaggerRow(parent, text, className)
    {
        parent.appendChild(h('div', 'af-swagger-row' + (className ? ' ' + className : ''), text));
    }

    function renderSwaggerOperation(parent, descriptor)
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

    function renderContract()
    {
        contractContent.innerHTML = '';
        var component = selectedContractComponentId != null ? model.getCell(selectedContractComponentId) : null;

        if (component == null)
        {
            component = componentForCell(graph.getSelectionCell());
        }

        if (component == null)
        {
            for (var id in model.cells)
            {
                var candidate = model.cells[id];
                if (candidate != null && graph.getAttributeForCell(candidate, 'archiflowOpenApi', null) != null)
                {
                    component = candidate;
                    break;
                }
            }
        }

        if (component == null)
        {
            contractTarget.textContent = 'Selecciona un componente UML';
            contractContent.appendChild(h('div', 'af-contract-empty', 'Selecciona el componente del microservicio y pulsa “Importar OpenAPI”. El contrato quedará asociado a ese componente.'));
            return;
        }

        selectedContractComponentId = component.id;
        contractTarget.textContent = labelFor(component);
        var raw = graph.getAttributeForCell(component, 'archiflowOpenApi', null);

        if (raw == null)
        {
            contractContent.appendChild(h('div', 'af-contract-empty', 'Este componente todavía no tiene contrato. Puedes cargar OpenAPI 3.x o Swagger 2.0 en JSON, YAML o YML.'));
            return;
        }

        var contract;
        try
        {
            contract = JSON.parse(raw);
        }
        catch (error)
        {
            contractContent.appendChild(h('div', 'af-contract-empty', 'El contrato asociado no se puede leer. Vuelve a importarlo.'));
            return;
        }

        var info = contract.info || {};
        var apiInfo = h('div', 'af-api-info');
        apiInfo.appendChild(h('div', 'af-api-title', info.title || labelFor(component)));
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
                renderSwaggerOperation(contractContent, groups[order[j]][k]);
            }
        }
    }

    function renderPanelMode()
    {
        var contractActive = panelMode === 'contract';
        contractNavButton.classList.toggle('af-active', contractActive);
        flowNavButton.classList.toggle('af-active', !contractActive);
        contractTools.style.display = contractActive ? '' : 'none';
        contractContent.style.display = contractActive ? '' : 'none';
        flowbar.style.display = contractActive ? 'none' : '';
        stepsStrip.style.display = contractActive ? 'none' : '';
        stepActions.style.display = contractActive || activeFlow().steps.length === 0 ? 'none' : 'flex';
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
            graph.setAttributeForCell(serviceA, 'archiflowOpenApi', JSON.stringify(clientesContract));
            graph.setAttributeForCell(serviceA, 'archiflowContractFile', 'clientes-api.yaml');
            graph.setAttributeForCell(serviceB, 'archiflowOpenApi', JSON.stringify(riesgoContract));
            graph.setAttributeForCell(serviceB, 'archiflowContractFile', 'riesgo-api.yaml');

            var demoEndpoints = [
                [clientesGet, 'GET', '/v1/clientes/{id}', 'consultarCliente'],
                [clientesValidar, 'POST', '/v1/clientes/validar', 'validarCliente'],
                [riesgoPerfil, 'GET', '/internal/perfil/{id}', 'obtenerPerfilRiesgo'],
                [riesgoEvaluar, 'POST', '/internal/evaluaciones', 'evaluarSolicitud']
            ];
            for (var endpointIndex = 0; endpointIndex < demoEndpoints.length; endpointIndex++)
            {
                graph.setAttributeForCell(demoEndpoints[endpointIndex][0], 'archiflowContractEndpoint', '1');
                graph.setAttributeForCell(demoEndpoints[endpointIndex][0], 'archiflowHttpMethod', demoEndpoints[endpointIndex][1]);
                graph.setAttributeForCell(demoEndpoints[endpointIndex][0], 'archiflowPath', demoEndpoints[endpointIndex][2]);
                graph.setAttributeForCell(demoEndpoints[endpointIndex][0], 'archiflowOperationId', demoEndpoints[endpointIndex][3]);
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

            store = { version: 1, activeFlowId: flow.id, flows: [flow] };
            selectedContractComponentId = serviceA.id;
            graph.setAttributeForCell(model.getRoot(), STORE_ATTRIBUTE, JSON.stringify(store));
        }
        finally
        {
            model.endUpdate();
        }

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
        loadStore();
        refreshBadges();
        render();
    });

    loadStore();
    render();

    if (urlParams.archiflowDemo === '1')
    {
        window.setTimeout(createDemo, 650);
    }
});
