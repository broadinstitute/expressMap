"use strict";
import {json, tsv} from "d3-fetch";
import {select, selectAll, event} from "d3-selection";
import {keys, values} from "d3-collection";

import {getGtexUrls,
        getTissueClusters,
        getGeneClusters,
        parseGenes,
        parseMedianTPM,
        parseTissues,
        parseMedianExpression,
        parseGeneExpressionForViolin
} from "./modules/gtexDataParser";
import {colorChart} from "./modules/Colors";
import {downloadSvg} from "./modules/utils";

import DendroHeatmapConfig from "./modules/DendroHeatmapConfig";
import DendroHeatmap from "./modules/DendroHeatmap";
import GroupedViolin from "./modules/GroupedViolin";

/**
 * Mayo demo
 * @param domId
 * @param toolbarId
 * @param urls
 */
// export function renderMayo(domId, toolbarId, urls=getGtexUrls()){
//     // - gets static data
//     const tissueTree = getTissueClusters('top50Cerebellum_AD'),
//           geneTree = getGeneClusters('top50Cerebellum_AD');
//     Promise.all([json(urls.tissue), tsv(urls.mayoGeneExp)])
//         .then(function(args){
//             const tissues = parseTissues(args[0]);
//             const expression = parseMedianTPM(args[1], true);
//             const config = new DendroHeatmapConfig("chart", window.innerWidth);
//             const dmap = new DendroHeatmap(tissueTree, geneTree, expression, "YlGnBu", 2, config, true, 10);
//             dmap.render(domId);
//             // customization for GTEx
//             const tissueDict = tissues.reduce((a, d)=>{
//                 if(!d.hasOwnProperty("tissueId")) throw "tissue has no attr tissue_id";
//                 a[d.tissueId] = d;
//                 return a;
//             }, {});
//             const geneDict = dmap.data.heatmap.reduce((a, d, i)=>{
//                 if (!d.hasOwnProperty("gencodeId")) throw "gene has no attr gencodeId";
//                 a[d.gencodeId]=d;
//                 return a;
//             }, {});
//             _customizeLabels(dmap, tissueDict, geneDict);
//             _addTissueColors(dmap, tissueDict);
//             _customizeMouseEvents(dmap, tissueDict, geneDict);
//             _createToolbar(domId, toolbarId, undefined, dmap, tissueDict, [], urls);
//             $('#spinner').hide(); // TODO: remove hard-coded dom ID
//         })
//         .catch(function(err){throw err});
// }

// export function reset(ids){
//     ids.forEach((d)=>{$(`#${d}`).empty()});
// }

/**
 * Create the tissue (dataset) dropdown menu using select2
 * @param domId {String} the dom ID of the menu
 * @param urls {Object} of web service urls with attr: tissue
 */
export function createDatasetMenu(domId, urls = getGtexUrls()){
    json(urls.tissue)
        .then(function(results){
            let tissues = parseTissues(results);
            tissues.forEach((d) => {
                d.id = d.tissueId;
                d.text = d.tissueName;
            });
            tissues.sort((a, b) => {
                if(a.tissueName < b.tissueName) return -1;
                if(a.tissueName > b.tissueName) return 1;
                return 0;
            });

            // external library dependency: select2
            $(`#${domId}`).select2({
                placeholder: 'Select a data set',
                data: tissues
            });

        })
        .catch(function(err){console.error(err)});

}

/**
 * Render top expressed genes in a given tissue
 * @param tissueId
 * @param domId {String} the dendroheatmap's DIV ID
 * @param toolbarId {String} the tool bar DOM ID
 * @param infoId {String} the message box DOM ID
 * @param urls {Dictionary} of GTEx web services urls
 * @param useFilters {Boolean} if the filter is applied, and if undefined, it means no filter
 */
export function renderTopExpressed(tissueId, heatmapRootId, violinRootId, urls=getGtexUrls(), useFilters=true){
    // getting the top expressed genes in tissueId
    const url = useFilters?urls.topInTissueFiltered:urls.topInTissue;
    const $filterInfoDiv = $(`#filterInfo`).length==0?$('<div/>').attr('id', 'filterInfo').appendTo('body'):$(`#filterInfo`);
    if(useFilters) $filterInfoDiv.html("Mitochondrial genes are excluded.<br/>");
    else $filterInfoDiv.html("Mitochondrial genes are included.<br/>");

    json(url+ tissueId)
        .then(function(results){ // top 50 expressed genes in tissueId
            const topGeneList = results.topExpressedGene.map(d=>d.gencodeId);
            const callback = function(){
                _styleSelectedTissue(tissueId);
            };
            searchById(topGeneList, [tissueId], heatmapRootId, violinRootId, urls, useFilters, callback);
        })
        .catch(function(err){
            console.error(err);
        });
}

export function searchById(glist, tlist, heatmapRootId, violinRootId, urls=getGtexUrls(), useFilters=undefined, callback=undefined){
    $('#spinner').show();
    $(`#${heatmapRootId}`).empty(); // clear the root DOM content
    const MAX = 50;
    const $message = $('<div/>').appendTo(`#${heatmapRootId}`);
    let message = "";
    if (glist.length > MAX) {
        message = `Warning: Too many genes. Input list truncated to the first ${MAX}. <br/>`;
        glist = glist.slice(0, MAX);
    }
    Promise.all([json(urls.tissue), json(urls.geneId+glist.join(","))])
       .then(function(args){
           const tissues = parseTissues(args[0]);

           // genes
           const genes = parseGenes(args[1]);
           // error-checking
           message += _validateGenes(heatmapRootId, genes, glist);
           $message.html(message);

           // get median expression data and clusters of the input genes in all tissues
           json(urls.medExpById + genes.map((g)=>g.gencodeId).join(","))
               .then(function(eData){
                   $('#spinner').hide();
                    _renderDendroHeatmap(genes, tissues, tlist, eData, heatmapRootId, violinRootId, urls, useFilters);
               })
               .catch(function(err){console.error(err)});
       })
       .catch(function(err){console.error(err)});
}

function _validateGenes(domId, genes, input){
    let message = "";

    if (genes.length == 0) message = "Fatal Error: the gene list is empty.<br/>";
    else {
        if (genes.length < input.length){
            let allIds = [];
            genes.forEach((g)=>{
                // compile a list of all known IDs
                allIds.push(g.gencodeId);
                allIds.push(g.geneSymbolUpper);
                allIds.push(g.ensemblId);
            });
            let missingGenes = input.filter((g)=>!allIds.includes(g.toLowerCase())&&!allIds.includes(g.toUpperCase()));
            message = `Warning: Not all genes are found: ${missingGenes.join(",")}<br/>`;
        }
    }
    return message;
}

function _renderDendroHeatmap(genes, tissues, queryTissues, data, heatmapRootId, violinRootId, urls=getGtexUrls(), useFilters=undefined){
    const expression = parseMedianExpression(data); // the parser determines the orientations of the heatmap
    const ids = {
        root: heatmapRootId,
        violin: violinRootId,
        svg: `${heatmapRootId}-svg`,
        tooltip: "heatmapTooltip",
        toolbar: "heatmapToolbar",
        clone: "heatmapClone",
        buttons: {
            save: "heatmapSave",
            filter: "heatmapFilter",
            sort: "heatmapSortTissue",
            cluster: "heatmapClusterTissue"
        }
    };
    // build the dom components
    if($(`#${ids.tooltip}`).length == 0) $('<div/>').attr('id', ids.tooltip).appendTo($('body'));
    ["toolbar", "clone"].forEach((key)=>{
        $('<div/>').attr("id", ids[key]).appendTo($(`#${ids.root}`));
    });
    // jQuery
    let WIDTH = $(`#${ids.root}`).parent().width()==0?window.innerWidth:$(`#${ids.root}`).parent().width();
    const config = new DendroHeatmapConfig(WIDTH);
    const dmap = new DendroHeatmap(data.clusters.tissue, data.clusters.gene, expression, "YlGnBu", 2, config);

    // heatmap rendering
    if (genes.length < 3){
        // too few genes to cluster
        dmap.render(ids.root, ids.svg, true, false)
    }
    else {dmap.render(ids.root, ids.svg)}

    /***** customization for GTEx expression heatmap *****/
    // tooltip
    dmap.createTooltip(ids.tooltip);

    // Change row labels to tissue names //
    const tissueDict = tissues.reduce((a, d)=>{
        if (!d.hasOwnProperty("tissueId")) throw "tissue has not attr tissue_id";
        a[d.tissueId] = d;
        return a;
    }, {});
    select("#" + dmap.config.panels.main.id).selectAll(".exp-map-xlabel")
        .text((d) => tissueDict[d]===undefined?d:tissueDict[d].tissueName);

    // Change column labels to gene symbols //
    const geneDict = dmap.data.heatmap.reduce((a, d, i)=>{
        if (!d.hasOwnProperty("gencodeId")) throw "gene has no attr gencodeId";
        a[d.gencodeId]=d;
        return a;
    }, {});
    select("#" + dmap.config.panels.main.id).selectAll(".exp-map-ylabel")
        .text((d) => geneDict[d]===undefined?d:geneDict[d].geneSymbol);

    // Add tissue color boxes //
    _addTissueColors(dmap, tissueDict);

    // Add a toolbar
    _addToolBar(dmap, ids, tissueDict, queryTissues, urls, useFilters);

    // mouse events
    _customizeMouseEvents(dmap, tissueDict, geneDict)
}

/**
 * Search gene expression by gene IDs and tissue IDs
 * @param glist {List} of gencode IDs or gene IDs
 * @param tlist {List} of tissue IDs: to search by tissue IDs is not yet implemented
 * @param domId {String} the DIV ID of the svg
 * @param infoId {String} the DOM ID of the message info box
 * @param toolbarId {String} the DOM ID of the toolbar
 * @param urls {Object} of web service urls with attr: tissue, geneId, medExpById
 * @param useFilters {Boolean} indicating whether gene filter is applied, or use undefined for no filtering
 * @returns {*}
 */
export function searchByIdOld(glist, tlist, domId, toolbarId, infoId, urls = getGtexUrls(), useFilters=undefined, callback=undefined){
    reset([domId, toolbarId, infoId, "violinRoot"]);
    $('#spinner').show();
    if (select(`#${domId}`).empty()) throw `Fatal Error: DOM element with id ${domId} does not exist;`;
    let message = "";

    Promise.all([json(urls.tissue), json(urls.geneId+glist.join(","))])
        .then(function(args){
             const tissues = parseTissues(args[0]),
                max = 50;

             const attr = "geneId";
            if (!args[1].hasOwnProperty(attr)) throw "gene web service parsing error";
            let geneObjects = args[1][attr];
            if (geneObjects.length == 0) {
                // validate if gene list is empty
                message = "Fatal Error: the gene list is empty.<br/>";
            } else {
                // more input validation
                if (geneObjects.length < glist.length) { // validate if all input genes are found
                    const allIds = [];
                    geneObjects.forEach((d)=>{
                        allIds.push(d.gencodeId);
                        allIds.push(d.geneSymbolUpper);
                        allIds.push(d.ensemblId);
                    }); // gather all IDs in retrieved geneObjects
                    const missingGenes = glist.filter((d) => !allIds.includes(d));

                    message = `Warning: Not all genes are found: ${missingGenes.join(",")}<br/>`;
                }
                if (geneObjects.length > max) { // validate if the number of input genes exceeds the maximum
                    //language=HTML
                    message += `Warning: Too many genes. Input list truncated to the first ${max}.<br/>`;
                    geneObjects = geneObjects.slice(0, max); // slice the input gene list to the maximum allowed entries
                }

                // visualization rendering
                // get all median express data of these genes in all tissues
                const gencodeIds = geneObjects.map((d) => d.gencodeId);
                json(urls.medExpById + gencodeIds.join(","))
                    .then(function(eData) {
                        const tissueTree = eData.clusters.tissue,
                            geneTree = eData.clusters.gene,
                            expression = parseMedianExpression(eData);
                        let WIDTH = $(`#${domId}`).parent().width();
                        WIDTH = WIDTH == 0?window.innerWidth:WIDTH;
                        const config = new DendroHeatmapConfig("chart", WIDTH);
                        const dmap = new DendroHeatmap(tissueTree, geneTree, expression, "YlGnBu", 2, config);

                        if (gencodeIds.length < 3) {
                            dmap.render(domId, true, false)
                        } else {
                            dmap.render(domId);
                        }

                        $('#spinner').hide();
                        // customization for GTEx
                        const tissueDict = tissues.reduce((a, d)=>{
                            if (!d.hasOwnProperty("tissueId")) throw "tissue has not attr tissue_id";
                            a[d.tissueId] = d;
                            return a;
                        }, {});
                        const geneDict = dmap.data.heatmap.reduce((a, d, i)=>{
                            if (!d.hasOwnProperty("gencodeId")) throw "gene has no attr gencodeId";
                            a[d.gencodeId]=d;
                            return a;
                        }, {});
                        _customizeLabels(dmap, tissueDict, geneDict);
                        _addTissueColors(dmap, tissueDict);
                        _customizeMouseEvents(dmap, tissueDict, geneDict);
                        _createToolbar(domId, toolbarId, infoId, dmap, tissueDict, tlist, urls, useFilters);
                        if(useFilters !== undefined){
                            message += useFilters?"Mitochondrial genes are excluded.":"Mitochondrial genes are included";
                        }
                        $(`#${infoId}`).html(message);

                        if(callback !== undefined) callback();

                    })
                    .catch(function(err){console.error(err)});
            }

        })
        .catch(function(err){throw err});
}

/**
 * For top expressed query, highlight the query tissue label
 * @param tissueId {String} the tissue ID
 * Dependencies: expressMap.css
 */
function _styleSelectedTissue(tissueId){
    selectAll(".exp-map-xlabel").filter((d)=>d==tissueId)
        .classed("query", true);
}

/**
 * Adds GTEx tissue colors to the tissue labels (column names of the heatmap)
 * @param dmap {DendroHeatmap}
 * @param tissueDict {Dictionary} of GTEx tissue objects indexed by tissue_id
 */
function _addTissueColors(dmap, tissueDict){

    const id = dmap.config.panels.main.id;
    const heatmap = dmap.objects.heatmap;

    let cells = select(`#${id}`).selectAll(".exp-map-xcolor").data(heatmap.xList);
    let leaves = select(`#${id}`).selectAll(".leaf-color").data(heatmap.xList);

    // update
    cells.attr("x", (d)=>heatmap.xScale(d))
        .attr("y", (d)=>heatmap.yScale.range()[1] + 5);
    leaves.attr("x", (d)=>heatmap.xScale(d))
        .attr("y", (d)=>heatmap.yScale.range()[0] - 10);

    // create new elements
    cells.enter().append("rect")
        .attr("x", (d)=>heatmap.xScale(d))
        .attr("y", (d)=>heatmap.yScale.range()[1] + 5)
        .attr("width", heatmap.xScale.bandwidth())
        .attr("height", heatmap.yScale.bandwidth()*0.5)
        .classed("exp-map-xcolor", true)
        .merge(cells)
        .style("fill", (d) => tissueDict[d] === undefined? "#000000": `#${tissueDict[d].colorHex}`);

    leaves.enter().append("rect")
        .attr("x", (d)=>heatmap.xScale(d))
        .attr("y", (d)=>heatmap.yScale.range()[0] - 10)
        .attr("width", heatmap.xScale.bandwidth())
        .attr("height", heatmap.yScale.bandwidth()*0.5)
        .classed("leaf-color", true)
        .merge(leaves)
        .style("fill", (d) => tissueDict[d] === undefined? "#000000": `#${tissueDict[d].colorHex}`);
    // exit and remove
    cells.exit().remove();
    leaves.exit().remove();

}

/**
 * Customize the dendropHeatmap mouse events
 * dependencies: CSS classes from expressMap.css
 * @param dmap {DendroHeatmap}
 * @param tissueDict {Dictionary}: tissue objects indexed by tissue_id, with attr: tissue_name
 * @param geneDict {Dictionary}: gene objects indexed by gencode ID, with attr: geneSymbol
 */
function _customizeMouseEvents(dmap, tissueDict, geneDict) {
    const svg = dmap.visualComponents.svg;
    const tooltip = dmap.tooltip;
    dmap.data.external = [];
    const cellMouseover = function(d) {
        const selected = select(this);
        dmap.objects.heatmap.cellMouseover(selected); // call the default heatmap mouse over event first
        let tissue = tissueDict[d.x]===undefined?d.x:tissueDict[d.x].tissueName;
        let gene = geneDict[d.y]===undefined?d.y:geneDict[d.y].geneSymbol;

        tooltip.show(`Tissue: ${tissue}<br/> Gene: ${gene}<br/> Median TPM: ${parseFloat(d.originalValue.toExponential()).toPrecision(4)}`)

    };

    const cellMouseout = function(d){
        svg.selectAll("*").classed('highlighted', false);
        tooltip.hide();
    };

    // gene boxplot prep: assign a colorIndex to each gene
    const colors = colorChart();
    keys(geneDict).forEach((d, i)=>{geneDict[d].color = colors[i]});
    const ylabelClick = function(d){
        let s = select(this);
        let action = "";

        // toggles click/unclick events
        // if the DOM has the class "clicked", then unclick it
        if (s.classed("clicked")) {
            s.classed("clicked", false);
            action = "delete";
        }
        else {
            // else click it
            // selectAll(".clicked").classed("clicked", false); // first clears all clicked labels if any
            s.classed("clicked", true); // click this DOM element
            action = "add";
        }
        _renderViolinPlot(action, d, geneDict, tissueDict, dmap);
    };

    svg.selectAll(".exp-map-cell")
        .on("mouseover", cellMouseover)
        .on("mouseout", cellMouseout);

    svg.selectAll(".exp-map-ylabel")
        .style("cursor", "pointer")
        .on("click", ylabelClick);
}

/**
 * renders the gene expression violin plot
 * @param action {ENUM} add, new, or delete
 * @param gene {String} gencode ID
 * @param geneDict {Dictionary} gencode ID => gene object with attribute: index
 * @param tissueDict {Dictionary} tissue objects indexed by tissue ID
 * @param dmap {DendroHeatmap}
 */
function _renderViolinPlot(action, gene, geneDict, tissueDict, dmap) {


    // action
    switch(action) {
        case "delete": {
            dmap.data.external = dmap.data.external.filter((d)=>d.gencodeId!=gene);
            _renderViolinHelper(dmap.data.external, dmap, tissueDict);
            break;
        }
        case "add": {
            const url = getGtexUrls().geneExp + gene;
            const colors = {};
            colors[gene] = geneDict[gene].color;
            json(url)
                .then(function (d) {
                    if (dmap.data.external === undefined) dmap.data.external = [];
                    dmap.data.external = dmap.data.external.concat(parseGeneExpressionForViolin(d, true, colors));
                    _renderViolinHelper(dmap.data.external, dmap, tissueDict);
                })
                .catch(function(err){console.error(err)});
            break;
        }
        default: {
            console.warn("action not understood.");
            break;
        }
    }
}

function _renderViolinHelper(data, dmap, tissueDict){
    // plot configurations
    const id = {
        root: "violinRoot", // the root <div> ID
        tooltip: "violinTooltip",
        toolbar: "violinToolbar",
        clone: "violinClone",
        chart: "violinPlot",
        svg: "violinSvg",
        buttons: {
            save: "violinSave"
        }
    };

    // error-checking the required DOM elements
    const rootId = `#${id.root}`;
    const tooltipId = `#${id.tooltip}`;
    if ($(rootId).length == 0) throw 'Violin Plot Error: rootId does not exist.';
    if ($(tooltipId).length == 0) $('<div/>').attr('id', id.tooltip).appendTo($('body')); // create it if not already present on the html document

    // clear previously rendered plot
    select(rootId).selectAll("*").remove();

    // rebuild the dom components within the root div
    ["toolbar", "chart", "clone"].forEach((key)=>{
        $('<div/>').attr("id", id[key]).appendTo($(rootId));
    });


    if (data.length == 0){ // no expression data, no need to proceed
        select(rootId).style("opacity", 0.0);
        return;
    }
    // tissueOrder is a list of tissue objects {id:display name} in the same order as the x axis of the heat map.
    let tissueOrder = dmap.objects.heatmap.xScale.domain().map((d, i) => {return {id:d, name:tissueDict[d].tissueName}});
    const genes = data.reduce((arr, d)=>{arr[d.label]=1; return arr}, {});
    const gCounts = Object.keys(genes).length;


    if (gCounts == 0){
        select(rootId).style("opacity", 0.0);
        return
    }

    select(rootId).style("opacity", 1.0); // makes the boxplot section visible
    const margin = _setViolinPlotMargins(50, 50, 150, dmap.config.panels.main.x);
    let width = 20 * Object.keys(genes).length * tissueOrder.length;
    width = width < dmap.config.panels.main.w? dmap.config.panels.main.w: width;
    const dim = _setViolinPlotDimensions(width, 150, margin);


    // render the violin
    const dom = select(`#${id.chart}`)
                // .style("opacity", 1.0)
                .append("svg")
                .attr("width", dim.outerWidth)
                .attr("height", dim.outerHeight)
                .attr("id", id.svg)
                .append("g")
                .attr("transform", `translate(${margin.left}, ${margin.top})`);

    const violin = new GroupedViolin(data);
    const tooltip = violin.createTooltip(id.tooltip);
    const toolbar = violin.createToolbar(id.toolbar, tooltip);
    toolbar.createDownloadButton(id.buttons.save, id.svg, `${id.root}-save.svg`, id.clone);

    const showDivider = gCounts == 1? false: true;
    violin.render(dom, dim.width, dim.height, 0.30, tissueOrder.map((d)=>d.id), [], "log10(TPM)", true, false, 0, false, showDivider, true);
    _addViolinTissueColorBand(violin, dom, tissueDict, "bottom");
    _changeViolinXLabel(dom, tissueDict);
}

/**
 * Set the margins of the violin plot
 * @param top {Integer}
 * @param right {Integer}
 * @param bottom {integer}
 * @param left {Integer}
 * @returns {{top: number, right: number, bottom: number, left: number}}
 * @private
 */
function _setViolinPlotMargins(top=50, right=50, bottom=50, left=50){
    return {
        top: top,
        right: right,
        bottom: bottom,
        left: left
    };
}

/**
 * Set the dimensions of the violin plot
 * @param width {Integer}
 * @param height {Integer}
 * @param margin {Object} with attr: top, right, bottom, left
 * @returns {{width: number, height: number, outerWidth: number, outerHeight: number}}
 * @private
 */
function _setViolinPlotDimensions(width=1200, height=250, margin=_setMargins()){
    return {
        width: width,
        height: height,
        outerWidth: width + (margin.left + margin.right),
        outerHeight: height + (margin.top + margin.bottom)
    }
}

function _addViolinTissueColorBand(plot, dom, tissueDict, loc="top"){
     ///// add tissue colors
    const tissueG = dom.append("g");

    tissueG.selectAll(".tcolor").data(plot.scale.x.domain())
        .enter()
        .append("rect")
        .classed("tcolor", true)
        .attr("x", (g)=>plot.scale.x(g) )
        .attr("y", (g)=>loc=="top"?plot.scale.y.range()[1]-5:plot.scale.y.range()[0]-5)
        .attr("width", (g)=>plot.scale.x.bandwidth())
        .attr("height", 5)
        .style("stroke-width", 0)
        .style("fill", (g)=>`#${tissueDict[g].colorHex}`)
        .style("opacity", 0.7);
}

function _changeViolinXLabel(dom, tissueDict){
    /***** Change row labels to tissue names *****/
    dom.select(".violin-x-axis").selectAll("text")
        .text((d) => tissueDict[d]===undefined?d:tissueDict[d].tissueName);

}

/**
 * Add the toolbar
 * @param dmap {DendroHeatmap}
 * @param ids {Dictionary} of dome IDs with a list of buttons
 * @param tissueDict {Dictionary} of tissue objects indexed by tissue ID
 * @param queryTissues {List} of user-defined query tissues
 * @param urls {Dictionary} of GTEx web service URLs
 * @param useFilters {Boolean} whether the data uses gene list filters
 * @private
 */
function _addToolBar(dmap, ids, tissueDict, queryTissues=[], urls=getGtexUrls(), useFilters=undefined){
    let toolbar = dmap.createToolbar(ids.toolbar, dmap.tooltip);
    toolbar.createDownloadButton(ids.buttons.save, ids.svg, `${ids.root}-save.svg`, ids.clone);

    const __addFilter = ()=>{
        // so far this is only applicable for topExpressed gene heatmap
        const id = ids.buttons.filter;
        toolbar.createButton(id, 'fa-filter');
        select(`#${id}`)
            .on("click", function(){
                // toggle the applied filter
                renderTopExpressed(queryTissues[0], ids.root, ids.violin, urls, !useFilters);
            })
            .on("mouseover", function(){
                if(useFilters) toolbar.tooltip.show("Include Mitochondrial Genes");
                else toolbar.tooltip.show("Exclude Mitochondrial Genes");
            })
            .on("mouseout", function(){
                toolbar.tooltip.hide();
            });
    };

    const __addSortTissues = ()=>{
        const id = ids.buttons.sort;
        toolbar.createButton(id, 'fa-sort-alpha-down');
        select(`#${id}`)
            .on("click", function(){
                // hides the tissue dendrogram
                select("#" + dmap.config.panels.top.id).style("display", "None");
                // sort tissues
                let xlist = dmap.objects.heatmap.xList.sort();
                _sortTissues(xlist, dmap, tissueDict);
            })
            .on("mouseover", function(){
                toolbar.tooltip.show("Sort Tissues Alphabetically");
            })
            .on("mouseout", function(){
                toolbar.tooltip.hide();
            });

    };

    const __addClusterTissues = ()=>{
        const id = ids.buttons.cluster;
        toolbar.createButton(id, `fa-code-branch`);
        select(`#${id}`)
        .on("click", function(){
            select("#" + dmap.config.panels.top.id).style("display", "Block");  // shows the tissue dendrogram
            let xlist = dmap.objects.columnTree.xScale.domain();
            _sortTissues(xlist, dmap, tissueDict);
        })
        .on("mouseover", function(){
            toolbar.tooltip.show("Cluster Tissues");
        })
        .on("mouseout", function(){
            toolbar.tooltip.hide();
        });
    };
    if (useFilters !== undefined) __addFilter();
    __addSortTissues();
    __addClusterTissues();
}

/**
 * update the heatmap based on the order of the xlist
 * dependencies: CSS classes from expressMap.css
 * @param xlist {Heatmap XList}
 * @param dmap {DendroHeatmap}
 * @param tissueDict {Dictionary} of tissue objects indexed by tissue ID with attr, tissue_name
 */
function _sortTissues (xlist, dmap, tissueDict){
    // check if there's a query tissue, e.g. top-expressed heatmap
    let qId = undefined;
    const qTissue = select(".exp-map-xlabel.query");
    if (!qTissue.empty()) qId = qTissue.datum();

    // update the heatmap
    const dom = select("#"+dmap.config.panels.main.id);
    const dimensions = dmap.config.panels.main;
    dmap.objects.heatmap.redraw(dom, xlist, dmap.objects.heatmap.yList, dimensions);

    // change the tissue display text to tissue names
    selectAll(".exp-map-xlabel")
        .text((d) => tissueDict[d]===undefined?d:tissueDict[d].tissueName)
        .classed("query", false);
    _addTissueColors(dmap, tissueDict);

    // style the query tissue if found
    if (qId!==undefined) _styleSelectedTissue(qId);

    // hide the violin plot
    select('#violinRoot').style("opacity", 0.0);

    // deselect genes
    selectAll(".exp-map-ylabel").classed("clicked", false);
    dmap.data.external = undefined;

}

