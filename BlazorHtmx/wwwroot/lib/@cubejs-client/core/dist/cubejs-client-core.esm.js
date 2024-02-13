import { v4 } from 'uuid';
import dayjs from 'dayjs';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';
import en from 'dayjs/locale/en';
import { fromPairs, toPairs, equals, clone, indexBy, prop, mergeDeepLeft, pipe, map, filter, reduce, minBy, maxBy, flatten, pluck, mergeAll, uniq, dropLast, groupBy, unnest as unnest$1 } from 'ramda';
import fetch from 'cross-fetch';
import 'url-search-params-polyfill';

const DEFAULT_GRANULARITY = 'day';
const GRANULARITIES = [{
  name: undefined,
  title: 'w/o grouping'
}, {
  name: 'second',
  title: 'Second'
}, {
  name: 'minute',
  title: 'Minute'
}, {
  name: 'hour',
  title: 'Hour'
}, {
  name: 'day',
  title: 'Day'
}, {
  name: 'week',
  title: 'Week'
}, {
  name: 'month',
  title: 'Month'
}, {
  name: 'quarter',
  title: 'Quarter'
}, {
  name: 'year',
  title: 'Year'
}];
function removeEmptyQueryFields(_query) {
  const query = _query || {};
  return fromPairs(toPairs(query).map(([key, value]) => {
    if (['measures', 'dimensions', 'segments', 'timeDimensions', 'filters'].includes(key)) {
      if (Array.isArray(value) && value.length === 0) {
        return null;
      }
    }

    if (key === 'order' && value) {
      if (Array.isArray(value) && !value.length) {
        return null;
      } else if (!Object.keys(value).length) {
        return null;
      }
    }

    return [key, value];
  }).filter(Boolean));
}
function validateQuery(_query) {
  const query = _query || {};
  return removeEmptyQueryFields({ ...query,
    filters: (query.filters || []).filter(f => f.operator),
    timeDimensions: (query.timeDimensions || []).filter(td => !(!td.dateRange && !td.granularity))
  });
}
function areQueriesEqual(query1 = {}, query2 = {}) {
  return equals(Object.entries(query1 && query1.order || {}), Object.entries(query2 && query2.order || {})) && equals(query1, query2);
}
function defaultOrder(query) {
  const granularity = (query.timeDimensions || []).find(d => d.granularity);

  if (granularity) {
    return {
      [granularity.dimension]: 'asc'
    };
  } else if ((query.measures || []).length > 0 && (query.dimensions || []).length > 0) {
    return {
      [query.measures[0]]: 'desc'
    };
  } else if ((query.dimensions || []).length > 0) {
    return {
      [query.dimensions[0]]: 'asc'
    };
  }

  return {};
}
function defaultHeuristics(newState, oldQuery = {}, options) {
  const {
    query,
    ...props
  } = clone(newState);
  const {
    meta,
    sessionGranularity
  } = options;
  const granularity = sessionGranularity || DEFAULT_GRANULARITY;
  let state = {
    query,
    ...props
  };
  let newQuery = null;

  if (!areQueriesEqual(query, oldQuery)) {
    newQuery = query;
  }

  if (Array.isArray(newQuery) || Array.isArray(oldQuery)) {
    return newState;
  }

  if (newQuery) {
    if ((oldQuery.timeDimensions || []).length === 1 && (newQuery.timeDimensions || []).length === 1 && newQuery.timeDimensions[0].granularity && oldQuery.timeDimensions[0].granularity !== newQuery.timeDimensions[0].granularity) {
      state = { ...state,
        sessionGranularity: newQuery.timeDimensions[0].granularity
      };
    }

    if ((oldQuery.measures || []).length === 0 && (newQuery.measures || []).length > 0 || (oldQuery.measures || []).length === 1 && (newQuery.measures || []).length === 1 && oldQuery.measures[0] !== newQuery.measures[0]) {
      const [td] = newQuery.timeDimensions || [];
      const defaultTimeDimension = meta.defaultTimeDimensionNameFor(newQuery.measures[0]);
      newQuery = { ...newQuery,
        timeDimensions: defaultTimeDimension ? [{
          dimension: defaultTimeDimension,
          granularity: td && td.granularity || granularity,
          dateRange: td && td.dateRange
        }] : []
      };
      return { ...state,
        pivotConfig: null,
        shouldApplyHeuristicOrder: true,
        query: newQuery,
        chartType: defaultTimeDimension ? 'line' : 'number'
      };
    }

    if ((oldQuery.dimensions || []).length === 0 && (newQuery.dimensions || []).length > 0) {
      newQuery = { ...newQuery,
        timeDimensions: (newQuery.timeDimensions || []).map(td => ({ ...td,
          granularity: undefined
        }))
      };
      return { ...state,
        pivotConfig: null,
        shouldApplyHeuristicOrder: true,
        query: newQuery,
        chartType: 'table'
      };
    }

    if ((oldQuery.dimensions || []).length > 0 && (newQuery.dimensions || []).length === 0) {
      newQuery = { ...newQuery,
        timeDimensions: (newQuery.timeDimensions || []).map(td => ({ ...td,
          granularity: td.granularity || granularity
        }))
      };
      return { ...state,
        pivotConfig: null,
        shouldApplyHeuristicOrder: true,
        query: newQuery,
        chartType: (newQuery.timeDimensions || []).length ? 'line' : 'number'
      };
    }

    if (((oldQuery.dimensions || []).length > 0 || (oldQuery.measures || []).length > 0) && (newQuery.dimensions || []).length === 0 && (newQuery.measures || []).length === 0) {
      newQuery = { ...newQuery,
        timeDimensions: [],
        filters: []
      };
      return { ...state,
        pivotConfig: null,
        shouldApplyHeuristicOrder: true,
        query: newQuery,
        sessionGranularity: null
      };
    }

    return state;
  }

  if (state.chartType) {
    const newChartType = state.chartType;

    if ((newChartType === 'line' || newChartType === 'area') && (oldQuery.timeDimensions || []).length === 1 && !oldQuery.timeDimensions[0].granularity) {
      const [td] = oldQuery.timeDimensions;
      return { ...state,
        pivotConfig: null,
        query: { ...oldQuery,
          timeDimensions: [{ ...td,
            granularity
          }]
        }
      };
    }

    if ((newChartType === 'pie' || newChartType === 'table' || newChartType === 'number') && (oldQuery.timeDimensions || []).length === 1 && oldQuery.timeDimensions[0].granularity) {
      const [td] = oldQuery.timeDimensions;
      return { ...state,
        pivotConfig: null,
        shouldApplyHeuristicOrder: true,
        query: { ...oldQuery,
          timeDimensions: [{ ...td,
            granularity: undefined
          }]
        }
      };
    }
  }

  return state;
}
function isQueryPresent(query) {
  if (!query) {
    return false;
  }

  return (Array.isArray(query) ? query : [query]).every(q => q.measures && q.measures.length || q.dimensions && q.dimensions.length || q.timeDimensions && q.timeDimensions.length);
}
function movePivotItem(pivotConfig, sourceIndex, destinationIndex, sourceAxis, destinationAxis) {
  const nextPivotConfig = { ...pivotConfig,
    x: [...pivotConfig.x],
    y: [...pivotConfig.y]
  };
  const id = pivotConfig[sourceAxis][sourceIndex];
  const lastIndex = nextPivotConfig[destinationAxis].length - 1;

  if (id === 'measures') {
    destinationIndex = lastIndex + 1;
  } else if (destinationIndex >= lastIndex && nextPivotConfig[destinationAxis][lastIndex] === 'measures') {
    destinationIndex = lastIndex - 1;
  }

  nextPivotConfig[sourceAxis].splice(sourceIndex, 1);
  nextPivotConfig[destinationAxis].splice(destinationIndex, 0, id);
  return nextPivotConfig;
}
function moveItemInArray(list, sourceIndex, destinationIndex) {
  const result = [...list];
  const [removed] = result.splice(sourceIndex, 1);
  result.splice(destinationIndex, 0, removed);
  return result;
}
function flattenFilters(filters = []) {
  return filters.reduce((memo, filter) => {
    if (filter.or || filter.and) {
      return [...memo, ...flattenFilters(filter.or || filter.and)];
    }

    return [...memo, filter];
  }, []);
}
function getQueryMembers(query = {}) {
  const keys = ['measures', 'dimensions', 'segments'];
  const members = new Set();
  keys.forEach(key => (query[key] || []).forEach(member => members.add(member)));
  (query.timeDimensions || []).forEach(td => members.add(td.dimension));
  flattenFilters(query.filters).forEach(filter => members.add(filter.dimension || filter.member));
  return [...members];
}
function getOrderMembersFromOrder(orderMembers, order) {
  const ids = new Set();
  const indexedOrderMembers = indexBy(prop('id'), orderMembers);
  const entries = Array.isArray(order) ? order : Object.entries(order || {});
  const nextOrderMembers = [];
  entries.forEach(([memberId, currentOrder]) => {
    if (currentOrder !== 'none' && indexedOrderMembers[memberId]) {
      ids.add(memberId);
      nextOrderMembers.push({ ...indexedOrderMembers[memberId],
        order: currentOrder
      });
    }
  });
  orderMembers.forEach(member => {
    if (!ids.has(member.id)) {
      nextOrderMembers.push({ ...member,
        order: member.order || 'none'
      });
    }
  });
  return nextOrderMembers;
}
function aliasSeries(values, index, pivotConfig, duplicateMeasures) {
  const nonNullValues = values.filter(value => value != null);

  if (pivotConfig && pivotConfig.aliasSeries && pivotConfig.aliasSeries[index]) {
    return [pivotConfig.aliasSeries[index], ...nonNullValues];
  } else if (duplicateMeasures.has(nonNullValues[0])) {
    return [index, ...nonNullValues];
  }

  return nonNullValues;
}

dayjs.extend(quarterOfYear); // When granularity is week, weekStart Value must be 1. However, since the client can change it globally (https://day.js.org/docs/en/i18n/changing-locale)
// So the function below has been added.

const internalDayjs = (...args) => dayjs(...args).locale({ ...en,
  weekStart: 1
});

const TIME_SERIES = {
  day: range => range.by('d').map(d => d.format('YYYY-MM-DDT00:00:00.000')),
  month: range => range.snapTo('month').by('M').map(d => d.format('YYYY-MM-01T00:00:00.000')),
  year: range => range.snapTo('year').by('y').map(d => d.format('YYYY-01-01T00:00:00.000')),
  hour: range => range.by('h').map(d => d.format('YYYY-MM-DDTHH:00:00.000')),
  minute: range => range.by('m').map(d => d.format('YYYY-MM-DDTHH:mm:00.000')),
  second: range => range.by('s').map(d => d.format('YYYY-MM-DDTHH:mm:ss.000')),
  week: range => range.snapTo('week').by('w').map(d => d.startOf('week').format('YYYY-MM-DDT00:00:00.000')),
  quarter: range => range.snapTo('quarter').by('quarter').map(d => d.startOf('quarter').format('YYYY-MM-DDT00:00:00.000'))
};
const DateRegex = /^\d\d\d\d-\d\d-\d\d$/;
const LocalDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z?$/;

const groupByToPairs = keyFn => {
  const acc = new Map();
  return data => {
    data.forEach(row => {
      const key = keyFn(row);

      if (!acc.has(key)) {
        acc.set(key, []);
      }

      acc.get(key).push(row);
    });
    return Array.from(acc.entries());
  };
};

const unnest = arr => {
  const res = [];
  arr.forEach(subArr => {
    subArr.forEach(element => res.push(element));
  });
  return res;
};

const dayRange = (from, to) => ({
  by: value => {
    const results = [];
    let start = internalDayjs(from);
    const end = internalDayjs(to);

    while (start.isBefore(end) || start.isSame(end)) {
      results.push(start);
      start = start.add(1, value);
    }

    return results;
  },
  snapTo: value => dayRange(internalDayjs(from).startOf(value), internalDayjs(to).endOf(value)),
  start: internalDayjs(from),
  end: internalDayjs(to)
});
const QUERY_TYPE = {
  REGULAR_QUERY: 'regularQuery',
  COMPARE_DATE_RANGE_QUERY: 'compareDateRangeQuery',
  BLENDING_QUERY: 'blendingQuery'
};

class ResultSet {
  static measureFromAxis(axisValues) {
    return axisValues[axisValues.length - 1];
  }

  static timeDimensionMember(td) {
    return `${td.dimension}.${td.granularity}`;
  }

  static deserialize(data, options = {}) {
    return new ResultSet(data.loadResponse, options);
  }

  constructor(loadResponse, options = {}) {
    this.loadResponse = loadResponse;

    if (this.loadResponse.queryType != null) {
      this.queryType = loadResponse.queryType;
      this.loadResponses = loadResponse.results;
    } else {
      this.queryType = QUERY_TYPE.REGULAR_QUERY;
      this.loadResponse.pivotQuery = { ...loadResponse.query,
        queryType: this.queryType
      };
      this.loadResponses = [loadResponse];
    }

    if (!Object.values(QUERY_TYPE).includes(this.queryType)) {
      throw new Error('Unknown query type');
    }

    this.parseDateMeasures = options.parseDateMeasures;
    this.options = options;
    this.backwardCompatibleData = [];
  }

  drillDown(drillDownLocator, pivotConfig) {
    if (this.queryType === QUERY_TYPE.COMPARE_DATE_RANGE_QUERY) {
      throw new Error('compareDateRange drillDown query is not currently supported');
    }

    if (this.queryType === QUERY_TYPE.BLENDING_QUERY) {
      throw new Error('Data blending drillDown query is not currently supported');
    }

    const {
      query
    } = this.loadResponses[0];
    const {
      xValues = [],
      yValues = []
    } = drillDownLocator;
    const normalizedPivotConfig = this.normalizePivotConfig(pivotConfig);
    const values = [];
    normalizedPivotConfig.x.forEach((member, currentIndex) => values.push([member, xValues[currentIndex]]));
    normalizedPivotConfig.y.forEach((member, currentIndex) => values.push([member, yValues[currentIndex]]));
    const {
      filters: parentFilters = [],
      segments = []
    } = this.query();
    const {
      measures
    } = this.loadResponses[0].annotation;
    let [, measureName] = values.find(([member]) => member === 'measures') || [];

    if (measureName === undefined) {
      [measureName] = Object.keys(measures);
    }

    if (!(measures[measureName] && measures[measureName].drillMembers || []).length) {
      return null;
    }

    const filters = [{
      member: measureName,
      operator: 'measureFilter'
    }, ...parentFilters];
    const timeDimensions = [];
    values.filter(([member]) => member !== 'measures').forEach(([member, value]) => {
      const [cubeName, dimension, granularity] = member.split('.');

      if (granularity !== undefined) {
        const range = dayRange(value, value).snapTo(granularity);
        const originalTimeDimension = query.timeDimensions.find(td => td.dimension);
        let dateRange = [range.start, range.end];

        if (originalTimeDimension?.dateRange) {
          const [originalStart, originalEnd] = originalTimeDimension.dateRange;
          dateRange = [dayjs(originalStart) > range.start ? dayjs(originalStart) : range.start, dayjs(originalEnd) < range.end ? dayjs(originalEnd) : range.end];
        }

        timeDimensions.push({
          dimension: [cubeName, dimension].join('.'),
          dateRange: dateRange.map(dt => dt.format('YYYY-MM-DDTHH:mm:ss.SSS'))
        });
      } else if (value == null) {
        filters.push({
          member,
          operator: 'notSet'
        });
      } else {
        filters.push({
          member,
          operator: 'equals',
          values: [value.toString()]
        });
      }
    });

    if (timeDimensions.length === 0 && query.timeDimensions.length > 0 && query.timeDimensions[0].granularity == null) {
      timeDimensions.push(query.timeDimensions[0]);
    }

    return { ...measures[measureName].drillMembersGrouped,
      filters,
      ...(segments.length > 0 ? {
        segments
      } : {}),
      timeDimensions,
      segments,
      timezone: query.timezone
    };
  }

  series(pivotConfig) {
    return this.seriesNames(pivotConfig).map(({
      title,
      shortTitle,
      key
    }) => ({
      title,
      shortTitle,
      key,
      series: this.chartPivot(pivotConfig).map(({
        x,
        ...obj
      }) => ({
        value: obj[key],
        x
      }))
    }));
  }

  axisValues(axis, resultIndex = 0) {
    const {
      query
    } = this.loadResponses[resultIndex];
    return row => {
      const value = measure => axis.filter(d => d !== 'measures').map(d => row[d] != null ? row[d] : null).concat(measure ? [measure] : []);

      if (axis.find(d => d === 'measures') && (query.measures || []).length) {
        return query.measures.map(value);
      }

      return [value()];
    };
  }

  axisValuesString(axisValues, delimiter) {
    const formatValue = v => {
      if (v == null) {
        return '∅';
      } else if (v === '') {
        return '[Empty string]';
      } else {
        return v;
      }
    };

    return axisValues.map(formatValue).join(delimiter || ', ');
  }

  static getNormalizedPivotConfig(query = {}, pivotConfig = null) {
    const defaultPivotConfig = {
      x: [],
      y: [],
      fillMissingDates: true,
      joinDateRange: false
    };
    const {
      measures = [],
      dimensions = []
    } = query;
    const timeDimensions = (query.timeDimensions || []).filter(td => !!td.granularity);
    pivotConfig = pivotConfig || (timeDimensions.length ? {
      x: timeDimensions.map(td => ResultSet.timeDimensionMember(td)),
      y: dimensions
    } : {
      x: dimensions,
      y: []
    });
    pivotConfig = mergeDeepLeft(pivotConfig, defaultPivotConfig);

    const substituteTimeDimensionMembers = axis => axis.map(subDim => timeDimensions.find(td => td.dimension === subDim) && !dimensions.find(d => d === subDim) ? ResultSet.timeDimensionMember(query.timeDimensions.find(td => td.dimension === subDim)) : subDim);

    pivotConfig.x = substituteTimeDimensionMembers(pivotConfig.x);
    pivotConfig.y = substituteTimeDimensionMembers(pivotConfig.y);
    const allIncludedDimensions = pivotConfig.x.concat(pivotConfig.y);
    const allDimensions = timeDimensions.map(td => ResultSet.timeDimensionMember(td)).concat(dimensions);

    const dimensionFilter = key => allDimensions.includes(key) || key === 'measures';

    pivotConfig.x = pivotConfig.x.concat(allDimensions.filter(d => !allIncludedDimensions.includes(d) && d !== 'compareDateRange')).filter(dimensionFilter);
    pivotConfig.y = pivotConfig.y.filter(dimensionFilter);

    if (!pivotConfig.x.concat(pivotConfig.y).find(d => d === 'measures')) {
      pivotConfig.y.push('measures');
    }

    if (dimensions.includes('compareDateRange') && !pivotConfig.y.concat(pivotConfig.x).includes('compareDateRange')) {
      pivotConfig.y.unshift('compareDateRange');
    }

    if (!measures.length) {
      pivotConfig.x = pivotConfig.x.filter(d => d !== 'measures');
      pivotConfig.y = pivotConfig.y.filter(d => d !== 'measures');
    }

    return pivotConfig;
  }

  normalizePivotConfig(pivotConfig) {
    return ResultSet.getNormalizedPivotConfig(this.loadResponse.pivotQuery, pivotConfig);
  }

  timeSeries(timeDimension, resultIndex) {
    if (!timeDimension.granularity) {
      return null;
    }

    let {
      dateRange
    } = timeDimension;

    if (!dateRange) {
      const member = ResultSet.timeDimensionMember(timeDimension);
      const dates = pipe(map(row => row[member] && internalDayjs(row[member])), filter(Boolean))(this.timeDimensionBackwardCompatibleData(resultIndex));
      dateRange = dates.length && [reduce(minBy(d => d.toDate()), dates[0], dates), reduce(maxBy(d => d.toDate()), dates[0], dates)] || null;
    }

    if (!dateRange) {
      return null;
    }

    const padToDay = timeDimension.dateRange ? timeDimension.dateRange.find(d => d.match(DateRegex)) : !['hour', 'minute', 'second'].includes(timeDimension.granularity);
    const [start, end] = dateRange;
    const range = dayRange(start, end);

    if (!TIME_SERIES[timeDimension.granularity]) {
      throw new Error(`Unsupported time granularity: ${timeDimension.granularity}`);
    }

    return TIME_SERIES[timeDimension.granularity](padToDay ? range.snapTo('d') : range);
  }

  pivot(pivotConfig) {
    pivotConfig = this.normalizePivotConfig(pivotConfig);
    const {
      pivotQuery: query
    } = this.loadResponse;

    const pivotImpl = (resultIndex = 0) => {
      let groupByXAxis = groupByToPairs(({
        xValues
      }) => this.axisValuesString(xValues));

      const measureValue = (row, measure) => row[measure] || 0;

      if (pivotConfig.fillMissingDates && pivotConfig.x.length === 1 && equals(pivotConfig.x, (query.timeDimensions || []).filter(td => Boolean(td.granularity)).map(td => ResultSet.timeDimensionMember(td)))) {
        const series = this.loadResponses.map(loadResponse => this.timeSeries(loadResponse.query.timeDimensions[0], resultIndex));

        if (series[0]) {
          groupByXAxis = rows => {
            const byXValues = groupBy(({
              xValues
            }) => xValues[0], rows);
            return series[resultIndex].map(d => [d, byXValues[d] || [{
              xValues: [d],
              row: {}
            }]]);
          };
        }
      }

      const xGrouped = pipe(map(row => this.axisValues(pivotConfig.x, resultIndex)(row).map(xValues => ({
        xValues,
        row
      }))), unnest, groupByXAxis)(this.timeDimensionBackwardCompatibleData(resultIndex));
      const yValuesMap = {};
      xGrouped.forEach(([, rows]) => {
        rows.forEach(({
          row
        }) => {
          this.axisValues(pivotConfig.y, resultIndex)(row).forEach(values => {
            if (Object.keys(row).length > 0) {
              yValuesMap[values.join()] = values;
            }
          });
        });
      });
      const allYValues = Object.values(yValuesMap);
      const measureOnX = Boolean(pivotConfig.x.find(d => d === 'measures'));
      return xGrouped.map(([, rows]) => {
        const {
          xValues
        } = rows[0];
        const yGrouped = {};
        rows.forEach(({
          row
        }) => {
          const arr = this.axisValues(pivotConfig.y, resultIndex)(row).map(yValues => ({
            yValues,
            row
          }));
          arr.forEach(res => {
            yGrouped[this.axisValuesString(res.yValues)] = res;
          });
        });
        return {
          xValues,
          yValuesArray: unnest(allYValues.map(yValues => {
            const measure = measureOnX ? ResultSet.measureFromAxis(xValues) : ResultSet.measureFromAxis(yValues);
            return [[yValues, measureValue((yGrouped[this.axisValuesString(yValues)] || {
              row: {}
            }).row, measure)]];
          }))
        };
      });
    };

    const pivots = this.loadResponses.length > 1 ? this.loadResponses.map((_, index) => pivotImpl(index)) : [];
    return pivots.length ? this.mergePivots(pivots, pivotConfig.joinDateRange) : pivotImpl();
  }

  mergePivots(pivots, joinDateRange) {
    const minLengthPivot = pivots.reduce((memo, current) => memo != null && current.length >= memo.length ? memo : current, null);
    return minLengthPivot.map((_, index) => {
      const xValues = joinDateRange ? [pivots.map(pivot => pivot[index] && pivot[index].xValues || []).join(', ')] : minLengthPivot[index].xValues;
      return {
        xValues,
        yValuesArray: unnest(pivots.map(pivot => pivot[index].yValuesArray))
      };
    });
  }

  pivotedRows(pivotConfig) {
    // TODO
    return this.chartPivot(pivotConfig);
  }

  chartPivot(pivotConfig) {
    const validate = value => {
      if (this.parseDateMeasures && LocalDateRegex.test(value)) {
        return new Date(value);
      } else if (!Number.isNaN(Number.parseFloat(value))) {
        return Number.parseFloat(value);
      }

      return value;
    };

    const duplicateMeasures = new Set();

    if (this.queryType === QUERY_TYPE.BLENDING_QUERY) {
      const allMeasures = flatten(this.loadResponses.map(({
        query
      }) => query.measures));
      allMeasures.filter((e, i, a) => a.indexOf(e) !== i).forEach(m => duplicateMeasures.add(m));
    }

    return this.pivot(pivotConfig).map(({
      xValues,
      yValuesArray
    }) => {
      const yValuesMap = {};
      yValuesArray.forEach(([yValues, m], i) => {
        yValuesMap[this.axisValuesString(aliasSeries(yValues, i, pivotConfig, duplicateMeasures), ',')] = m && validate(m);
      });
      return {
        x: this.axisValuesString(xValues, ','),
        xValues,
        ...yValuesMap
      };
    });
  }

  tablePivot(pivotConfig) {
    const normalizedPivotConfig = this.normalizePivotConfig(pivotConfig || {});
    const isMeasuresPresent = normalizedPivotConfig.x.concat(normalizedPivotConfig.y).includes('measures');
    return this.pivot(normalizedPivotConfig).map(({
      xValues,
      yValuesArray
    }) => fromPairs(normalizedPivotConfig.x.map((key, index) => [key, xValues[index]]).concat(isMeasuresPresent ? yValuesArray.map(([yValues, measure]) => [yValues.length ? yValues.join() : 'value', measure]) : [])));
  }

  tableColumns(pivotConfig) {
    const normalizedPivotConfig = this.normalizePivotConfig(pivotConfig || {});
    const annotations = pipe(pluck('annotation'), reduce(mergeDeepLeft(), {}))(this.loadResponses);
    const flatMeta = Object.values(annotations).reduce((a, b) => ({ ...a,
      ...b
    }), {});
    const schema = {};

    const extractFields = key => {
      const {
        title,
        shortTitle,
        type,
        format,
        meta
      } = flatMeta[key] || {};
      return {
        key,
        title,
        shortTitle,
        type,
        format,
        meta
      };
    };

    const pivot = this.pivot(normalizedPivotConfig);
    (pivot[0] && pivot[0].yValuesArray || []).forEach(([yValues]) => {
      if (yValues.length > 0) {
        let currentItem = schema;
        yValues.forEach((value, index) => {
          currentItem[`_${value}`] = {
            key: value,
            memberId: normalizedPivotConfig.y[index] === 'measures' ? value : normalizedPivotConfig.y[index],
            children: currentItem[`_${value}`] && currentItem[`_${value}`].children || {}
          };
          currentItem = currentItem[`_${value}`].children;
        });
      }
    });

    const toColumns = (item = {}, path = []) => {
      if (Object.keys(item).length === 0) {
        return [];
      }

      return Object.values(item).map(({
        key,
        ...currentItem
      }) => {
        const children = toColumns(currentItem.children, [...path, key]);
        const {
          title,
          shortTitle,
          ...fields
        } = extractFields(currentItem.memberId);
        const dimensionValue = key !== currentItem.memberId || title == null ? key : '';

        if (!children.length) {
          return { ...fields,
            key,
            dataIndex: [...path, key].join(),
            title: [title, dimensionValue].join(' ').trim(),
            shortTitle: dimensionValue || shortTitle
          };
        }

        return { ...fields,
          key,
          title: [title, dimensionValue].join(' ').trim(),
          shortTitle: dimensionValue || shortTitle,
          children
        };
      });
    };

    let otherColumns = [];

    if (!pivot.length && normalizedPivotConfig.y.includes('measures')) {
      otherColumns = (this.loadResponses[0].query.measures || []).map(key => ({ ...extractFields(key),
        dataIndex: key
      }));
    } // Syntatic column to display the measure value


    if (!normalizedPivotConfig.y.length && normalizedPivotConfig.x.includes('measures')) {
      otherColumns.push({
        key: 'value',
        dataIndex: 'value',
        title: 'Value',
        shortTitle: 'Value',
        type: 'string'
      });
    }

    return normalizedPivotConfig.x.map(key => {
      if (key === 'measures') {
        return {
          key: 'measures',
          dataIndex: 'measures',
          title: 'Measures',
          shortTitle: 'Measures',
          type: 'string'
        };
      }

      return { ...extractFields(key),
        dataIndex: key
      };
    }).concat(toColumns(schema)).concat(otherColumns);
  }

  totalRow(pivotConfig) {
    return this.chartPivot(pivotConfig)[0];
  }

  categories(pivotConfig) {
    // TODO
    return this.chartPivot(pivotConfig);
  }

  seriesNames(pivotConfig) {
    pivotConfig = this.normalizePivotConfig(pivotConfig);
    const measures = pipe(pluck('annotation'), pluck('measures'), mergeAll)(this.loadResponses);
    const seriesNames = unnest(this.loadResponses.map((_, index) => pipe(map(this.axisValues(pivotConfig.y, index)), unnest, uniq)(this.timeDimensionBackwardCompatibleData(index))));
    const duplicateMeasures = new Set();

    if (this.queryType === QUERY_TYPE.BLENDING_QUERY) {
      const allMeasures = flatten(this.loadResponses.map(({
        query
      }) => query.measures));
      allMeasures.filter((e, i, a) => a.indexOf(e) !== i).forEach(m => duplicateMeasures.add(m));
    }

    return seriesNames.map((axisValues, i) => {
      const aliasedAxis = aliasSeries(axisValues, i, pivotConfig, duplicateMeasures);
      return {
        title: this.axisValuesString(pivotConfig.y.find(d => d === 'measures') ? dropLast(1, aliasedAxis).concat(measures[ResultSet.measureFromAxis(axisValues)].title) : aliasedAxis, ', '),
        shortTitle: this.axisValuesString(pivotConfig.y.find(d => d === 'measures') ? dropLast(1, aliasedAxis).concat(measures[ResultSet.measureFromAxis(axisValues)].shortTitle) : aliasedAxis, ', '),
        key: this.axisValuesString(aliasedAxis, ','),
        yValues: axisValues
      };
    });
  }

  query() {
    if (this.queryType !== QUERY_TYPE.REGULAR_QUERY) {
      throw new Error(`Method is not supported for a '${this.queryType}' query type. Please use decompose`);
    }

    return this.loadResponses[0].query;
  }

  pivotQuery() {
    return this.loadResponse.pivotQuery || null;
  }

  totalRows() {
    return this.loadResponses[0].total;
  }

  rawData() {
    if (this.queryType !== QUERY_TYPE.REGULAR_QUERY) {
      throw new Error(`Method is not supported for a '${this.queryType}' query type. Please use decompose`);
    }

    return this.loadResponses[0].data;
  }

  annotation() {
    if (this.queryType !== QUERY_TYPE.REGULAR_QUERY) {
      throw new Error(`Method is not supported for a '${this.queryType}' query type. Please use decompose`);
    }

    return this.loadResponses[0].annotation;
  }

  timeDimensionBackwardCompatibleData(resultIndex) {
    if (resultIndex === undefined) {
      throw new Error('resultIndex is required');
    }

    if (!this.backwardCompatibleData[resultIndex]) {
      const {
        data,
        query
      } = this.loadResponses[resultIndex];
      const timeDimensions = (query.timeDimensions || []).filter(td => Boolean(td.granularity));
      this.backwardCompatibleData[resultIndex] = data.map(row => ({ ...row,
        ...fromPairs(Object.keys(row).filter(field => timeDimensions.find(d => d.dimension === field) && !row[ResultSet.timeDimensionMember(timeDimensions.find(d => d.dimension === field))]).map(field => [ResultSet.timeDimensionMember(timeDimensions.find(d => d.dimension === field)), row[field]]))
      }));
    }

    return this.backwardCompatibleData[resultIndex];
  }

  decompose() {
    return this.loadResponses.map(result => new ResultSet({
      queryType: QUERY_TYPE.REGULAR_QUERY,
      pivotQuery: { ...result.query,
        queryType: QUERY_TYPE.REGULAR_QUERY
      },
      results: [result]
    }, this.options));
  }

  serialize() {
    return {
      loadResponse: clone(this.loadResponse)
    };
  }

}

class SqlQuery {
  constructor(sqlQuery) {
    this.sqlQuery = sqlQuery;
  }

  rawQuery() {
    return this.sqlQuery.sql;
  }

  sql() {
    return this.rawQuery().sql[0];
  }

}

/**
 * @module @cubejs-client/core
 */

const memberMap = memberArray => fromPairs(memberArray.map(m => [m.name, m]));

const operators = {
  string: [{
    name: 'contains',
    title: 'contains'
  }, {
    name: 'notContains',
    title: 'does not contain'
  }, {
    name: 'equals',
    title: 'equals'
  }, {
    name: 'notEquals',
    title: 'does not equal'
  }, {
    name: 'set',
    title: 'is set'
  }, {
    name: 'notSet',
    title: 'is not set'
  }, {
    name: 'startsWith',
    title: 'starts with'
  }, {
    name: 'notStartsWith',
    title: 'does not start with'
  }, {
    name: 'endsWith',
    title: 'ends with'
  }, {
    name: 'notEndsWith',
    title: 'does not end with'
  }],
  number: [{
    name: 'equals',
    title: 'equals'
  }, {
    name: 'notEquals',
    title: 'does not equal'
  }, {
    name: 'set',
    title: 'is set'
  }, {
    name: 'notSet',
    title: 'is not set'
  }, {
    name: 'gt',
    title: '>'
  }, {
    name: 'gte',
    title: '>='
  }, {
    name: 'lt',
    title: '<'
  }, {
    name: 'lte',
    title: '<='
  }],
  time: [{
    name: 'equals',
    title: 'equals'
  }, {
    name: 'notEquals',
    title: 'does not equal'
  }, {
    name: 'inDateRange',
    title: 'in date range'
  }, {
    name: 'notInDateRange',
    title: 'not in date range'
  }, {
    name: 'afterDate',
    title: 'after date'
  }, {
    name: 'afterOrOnDate',
    title: 'after or on date'
  }, {
    name: 'beforeDate',
    title: 'before date'
  }, {
    name: 'beforeOrOnDate',
    title: 'before or on date'
  }]
};
/**
 * Contains information about available cubes and it's members.
 */

class Meta {
  constructor(metaResponse) {
    this.meta = metaResponse;
    const {
      cubes
    } = this.meta;
    this.cubes = cubes;
    this.cubesMap = fromPairs(cubes.map(c => [c.name, {
      measures: memberMap(c.measures),
      dimensions: memberMap(c.dimensions),
      segments: memberMap(c.segments)
    }]));
  }

  membersForQuery(query, memberType) {
    return unnest$1(this.cubes.map(c => c[memberType])).sort((a, b) => a.title > b.title ? 1 : -1);
  }

  membersGroupedByCube() {
    const memberKeys = ['measures', 'dimensions', 'segments', 'timeDimensions'];
    return this.cubes.reduce((memo, cube) => {
      memberKeys.forEach(key => {
        let members = cube[key];

        if (key === 'timeDimensions') {
          members = cube.dimensions.filter(m => m.type === 'time');
        }

        memo[key] = [...memo[key], {
          cubeName: cube.name,
          cubeTitle: cube.title,
          type: cube.type,
          public: cube.public,
          members
        }];
      });
      return memo;
    }, {
      measures: [],
      dimensions: [],
      segments: [],
      timeDimensions: []
    });
  }

  resolveMember(memberName, memberType) {
    const [cube] = memberName.split('.');

    if (!this.cubesMap[cube]) {
      return {
        title: memberName,
        error: `Cube not found ${cube} for path '${memberName}'`
      };
    }

    const memberTypes = Array.isArray(memberType) ? memberType : [memberType];
    const member = memberTypes.map(type => this.cubesMap[cube][type] && this.cubesMap[cube][type][memberName]).find(m => m);

    if (!member) {
      return {
        title: memberName,
        error: `Path not found '${memberName}'`
      };
    }

    return member;
  }

  defaultTimeDimensionNameFor(memberName) {
    const [cube] = memberName.split('.');

    if (!this.cubesMap[cube]) {
      return null;
    }

    return Object.keys(this.cubesMap[cube].dimensions || {}).find(d => this.cubesMap[cube].dimensions[d].type === 'time');
  }

  filterOperatorsForMember(memberName, memberType) {
    const member = this.resolveMember(memberName, memberType);
    return operators[member.type] || operators.string;
  }

}

class ProgressResult {
  constructor(progressResponse) {
    this.progressResponse = progressResponse;
  }

  stage() {
    return this.progressResponse.stage;
  }

  timeElapsed() {
    return this.progressResponse.timeElapsed;
  }

}

class HttpTransport {
  constructor({
    authorization,
    apiUrl,
    method,
    headers = {},
    credentials
  }) {
    this.authorization = authorization;
    this.apiUrl = apiUrl;
    this.method = method;
    this.headers = headers;
    this.credentials = credentials;
  }

  request(method, {
    baseRequestId,
    ...params
  }) {
    let spanCounter = 1;
    const searchParams = new URLSearchParams(params && Object.keys(params).map(k => ({
      [k]: typeof params[k] === 'object' ? JSON.stringify(params[k]) : params[k]
    })).reduce((a, b) => ({ ...a,
      ...b
    }), {}));
    let url = `${this.apiUrl}/${method}${searchParams.toString().length ? `?${searchParams}` : ''}`;
    const requestMethod = this.method || (url.length < 2000 ? 'GET' : 'POST');

    if (requestMethod === 'POST') {
      url = `${this.apiUrl}/${method}`;
      this.headers['Content-Type'] = 'application/json';
    } // Currently, all methods make GET requests. If a method makes a request with a body payload,
    // remember to add {'Content-Type': 'application/json'} to the header.


    const runRequest = () => fetch(url, {
      method: requestMethod,
      headers: {
        Authorization: this.authorization,
        'x-request-id': baseRequestId && `${baseRequestId}-span-${spanCounter++}`,
        ...this.headers
      },
      credentials: this.credentials,
      body: requestMethod === 'POST' ? JSON.stringify(params) : null
    });

    return {
      /* eslint no-unsafe-finally: off */
      async subscribe(callback) {
        let result = {
          error: 'network Error' // add default error message

        };

        try {
          result = await runRequest();
        } finally {
          return callback(result, () => this.subscribe(callback));
        }
      }

    };
  }

}

class RequestError extends Error {
  constructor(message, response, status) {
    super(message);
    this.response = response;
    this.status = status;
  }

}

let mutexCounter = 0;
const MUTEX_ERROR = 'Mutex has been changed';
/**
 * Query result dataset formats enum.
 */

const ResultType = {
  DEFAULT: 'default',
  COMPACT: 'compact'
};

function mutexPromise(promise) {
  return new Promise(async (resolve, reject) => {
    try {
      resolve(await promise);
    } catch (error) {
      if (error !== MUTEX_ERROR) {
        reject(error);
      }
    }
  });
}

class CubejsApi {
  constructor(apiToken, options) {
    if (apiToken !== null && !Array.isArray(apiToken) && typeof apiToken === 'object') {
      options = apiToken;
      apiToken = undefined;
    }

    options = options || {};

    if (!options.transport && !options.apiUrl) {
      throw new Error('The `apiUrl` option is required');
    }

    this.apiToken = apiToken;
    this.apiUrl = options.apiUrl;
    this.method = options.method;
    this.headers = options.headers || {};
    this.credentials = options.credentials;
    this.transport = options.transport || new HttpTransport({
      authorization: typeof apiToken === 'function' ? undefined : apiToken,
      apiUrl: this.apiUrl,
      method: this.method,
      headers: this.headers,
      credentials: this.credentials
    });
    this.pollInterval = options.pollInterval || 5;
    this.parseDateMeasures = options.parseDateMeasures;
    this.updateAuthorizationPromise = null;
  }

  request(method, params) {
    return this.transport.request(method, {
      baseRequestId: v4(),
      ...params
    });
  }

  loadMethod(request, toResult, options, callback) {
    const mutexValue = ++mutexCounter;

    if (typeof options === 'function' && !callback) {
      callback = options;
      options = undefined;
    }

    options = options || {};
    const mutexKey = options.mutexKey || 'default';

    if (options.mutexObj) {
      options.mutexObj[mutexKey] = mutexValue;
    }

    const requestPromise = this.updateTransportAuthorization().then(() => request());
    let skipAuthorizationUpdate = true;
    let unsubscribed = false;

    const checkMutex = async () => {
      const requestInstance = await requestPromise;

      if (options.mutexObj && options.mutexObj[mutexKey] !== mutexValue) {
        unsubscribed = true;

        if (requestInstance.unsubscribe) {
          await requestInstance.unsubscribe();
        }

        throw MUTEX_ERROR;
      }
    };

    const loadImpl = async (response, next) => {
      const requestInstance = await requestPromise;

      const subscribeNext = async () => {
        if (options.subscribe && !unsubscribed) {
          if (requestInstance.unsubscribe) {
            return next();
          } else {
            await new Promise(resolve => setTimeout(() => resolve(), this.pollInterval * 1000));
            return next();
          }
        }

        return null;
      };

      const continueWait = async wait => {
        if (!unsubscribed) {
          if (wait) {
            await new Promise(resolve => setTimeout(() => resolve(), this.pollInterval * 1000));
          }

          return next();
        }

        return null;
      };

      if (options.subscribe && !skipAuthorizationUpdate) {
        await this.updateTransportAuthorization();
      }

      skipAuthorizationUpdate = false;

      if (response.status === 502) {
        await checkMutex();
        return continueWait(true);
      }

      let body = {};
      let text = '';

      try {
        text = await response.text();
        body = JSON.parse(text);
      } catch (_) {
        body.error = text;
      }

      if (body.error === 'Continue wait') {
        await checkMutex();

        if (options.progressCallback) {
          options.progressCallback(new ProgressResult(body));
        }

        return continueWait();
      }

      if (response.status !== 200) {
        await checkMutex();

        if (!options.subscribe && requestInstance.unsubscribe) {
          await requestInstance.unsubscribe();
        }

        const error = new RequestError(body.error, body, response.status); // TODO error class

        if (callback) {
          callback(error);
        } else {
          throw error;
        }

        return subscribeNext();
      }

      await checkMutex();

      if (!options.subscribe && requestInstance.unsubscribe) {
        await requestInstance.unsubscribe();
      }

      const result = toResult(body);

      if (callback) {
        callback(null, result);
      } else {
        return result;
      }

      return subscribeNext();
    };

    const promise = requestPromise.then(requestInstance => mutexPromise(requestInstance.subscribe(loadImpl)));

    if (callback) {
      return {
        unsubscribe: async () => {
          const requestInstance = await requestPromise;
          unsubscribed = true;

          if (requestInstance.unsubscribe) {
            return requestInstance.unsubscribe();
          }

          return null;
        }
      };
    } else {
      return promise;
    }
  }

  async updateTransportAuthorization() {
    if (this.updateAuthorizationPromise) {
      await this.updateAuthorizationPromise;
      return;
    }

    if (typeof this.apiToken === 'function') {
      this.updateAuthorizationPromise = new Promise(async (resolve, reject) => {
        try {
          const token = await this.apiToken();

          if (this.transport.authorization !== token) {
            this.transport.authorization = token;
          }

          resolve();
        } catch (error) {
          reject(error);
        } finally {
          this.updateAuthorizationPromise = null;
        }
      });
      await this.updateAuthorizationPromise;
    }
  }
  /**
   * Add system properties to a query object.
   * @param {Query} query
   * @param {string} responseFormat
   * @returns {void}
   * @private
   */


  patchQueryInternal(query, responseFormat) {
    if (responseFormat === ResultType.COMPACT && query.responseFormat !== ResultType.COMPACT) {
      return { ...query,
        responseFormat: ResultType.COMPACT
      };
    } else {
      return query;
    }
  }
  /**
   * Process result fetched from the gateway#load method according
   * to the network protocol.
   * @param {*} response
   * @returns ResultSet
   * @private
   */


  loadResponseInternal(response, options = {}) {
    if (response.results.length) {
      if (options.castNumerics) {
        response.results.forEach(result => {
          const numericMembers = Object.entries({ ...result.annotation.measures,
            ...result.annotation.dimensions
          }).map(([k, v]) => {
            if (v.type === 'number') {
              return k;
            }

            return undefined;
          }).filter(Boolean);
          result.data = result.data.map(row => {
            numericMembers.forEach(key => {
              if (row[key] != null) {
                row[key] = Number(row[key]);
              }
            });
            return row;
          });
        });
      }

      if (response.results[0].query.responseFormat && response.results[0].query.responseFormat === ResultType.COMPACT) {
        response.results.forEach((result, j) => {
          const data = [];
          result.data.dataset.forEach(r => {
            const row = {};
            result.data.members.forEach((m, i) => {
              row[m] = r[i];
            });
            data.push(row);
          });
          response.results[j].data = data;
        });
      }
    }

    return new ResultSet(response, {
      parseDateMeasures: this.parseDateMeasures
    });
  }

  load(query, options, callback, responseFormat = ResultType.DEFAULT) {
    if (responseFormat === ResultType.COMPACT) {
      if (Array.isArray(query)) {
        query = query.map(q => this.patchQueryInternal(q, ResultType.COMPACT));
      } else {
        query = this.patchQueryInternal(query, ResultType.COMPACT);
      }
    }

    return this.loadMethod(() => this.request('load', {
      query,
      queryType: 'multi'
    }), response => this.loadResponseInternal(response, options), options, callback);
  }

  subscribe(query, options, callback, responseFormat = ResultType.DEFAULT) {
    if (responseFormat === ResultType.COMPACT) {
      if (Array.isArray(query)) {
        query = query.map(q => this.patchQueryInternal(q, ResultType.COMPACT));
      } else {
        query = this.patchQueryInternal(query, ResultType.COMPACT);
      }
    }

    return this.loadMethod(() => this.request('subscribe', {
      query,
      queryType: 'multi'
    }), response => this.loadResponseInternal(response, options), { ...options,
      subscribe: true
    }, callback);
  }

  sql(query, options, callback) {
    return this.loadMethod(() => this.request('sql', {
      query
    }), response => Array.isArray(response) ? response.map(body => new SqlQuery(body)) : new SqlQuery(response), options, callback);
  }

  meta(options, callback) {
    return this.loadMethod(() => this.request('meta'), body => new Meta(body), options, callback);
  }

  dryRun(query, options, callback) {
    return this.loadMethod(() => this.request('dry-run', {
      query
    }), response => response, options, callback);
  }

}

var index = ((apiToken, options) => new CubejsApi(apiToken, options));

export default index;
export { CubejsApi as CubeApi, CubejsApi, DEFAULT_GRANULARITY, GRANULARITIES, HttpTransport, Meta, RequestError, ResultSet, aliasSeries, areQueriesEqual, defaultHeuristics, defaultOrder, flattenFilters, getOrderMembersFromOrder, getQueryMembers, isQueryPresent, moveItemInArray, movePivotItem, removeEmptyQueryFields, validateQuery };
//# sourceMappingURL=cubejs-client-core.esm.js.map