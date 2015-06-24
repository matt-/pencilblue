/*
 Copyright (C) 2015  PencilBlue, LLC

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

module.exports = function SiteQueryServiceModule(pb) {
  "use strict";
  var async = require('async');
  var SITE_FIELD = pb.SiteService.SITE_FIELD;
  var GLOBAL_SITE = pb.SiteService.GLOBAL_SITE;
  var _ = require('lodash');
  var util = pb.util;
  var DAO = pb.DAO;

  /**
   * Create an instance of the site query service specific to the given site
   *
   * @param {String} siteUId UID of site, should already be sanitized by SiteService
   * @param onlyThisSite {Boolean} for q, return results specific to this site instead of also looking in global
   * @constructor
   */
  function SiteQueryService(siteUId, onlyThisSite) {
    this.siteUId = pb.SiteService.getCurrentSite(siteUId);
    this.onlyThisSite = onlyThisSite;
    DAO.call(this);
  }

  util.inherits(SiteQueryService, DAO);

  function modifyLoadWhere(site, where) {
    if (pb.config.multisite) {
      where = _.clone(where);
      if (site === GLOBAL_SITE) {
        var siteDoesNotExist = {}, siteEqualToSpecified = {};
        siteDoesNotExist[SITE_FIELD] = {$exists: false};
        siteEqualToSpecified[SITE_FIELD] = site;

        addToOr(where, [siteDoesNotExist, siteEqualToSpecified]);
      } else {
        where[SITE_FIELD] = site;
      }
    }
    return where;
  }

  function modifyLoadOptions(site, options) {
    if (pb.config.multisite) {
      var target = _.clone(options);

      target.where = target.where || {};
      target.where = modifyLoadWhere(site, target.where);
      return target;
    }
    // else do nothing
    return options;
  }

  function addToOr(whereClause, conditions) {
    if ('$or' in whereClause) {
      var orClause = whereClause.$or;
      addToAnd(whereClause, [{$or: orClause}, {$or: conditions}]);
      delete whereClause.$or;
    } else {
      whereClause.$or = conditions;
    }
  }

  function addToAnd(whereClause, conditions) {
    if ('$and' in whereClause) {
      var andClause = whereClause.$and;
      andClause.push.apply(andClause, conditions);
    } else {
      whereClause.$and = conditions;
    }
  }

  function applySiteOperation(self, callback, delegate) {
    if (siteSpecific(self)) {
      delegate(self.siteUId, callback);
    } else {
      delegate(self.siteUId, function (err, cursor) {
        if (util.isError(err)) {
          callback(err, cursor);
        } else {
          cursor.count(function (countError, count) {
            if (util.isError(countError)) {
              callback(countError);
            } else if (count) {
              callback(err, cursor);
            } else {
              delegate(GLOBAL_SITE, callback);
            }
          });
        }
      })
    }
  }

  function siteSpecific(self) {
    return self.onlyThisSite || isGlobal(self.siteUId);
  }

  function isGlobal(siteUId) {
    return !siteUId || siteUId === GLOBAL_SITE;
  }

  /**
   * Overriding protected method of DAO to achieve site-aware query
   * @protected
   * @param options
   * @param callback
   */
  SiteQueryService.prototype._doQuery = function (options, callback) {
    var self = this;
    applySiteOperation(self, callback, function (site, opCallback) {
      var moddedOptions = modifyLoadOptions(site, options);
      DAO.prototype._doQuery.call(self, moddedOptions, opCallback);
    });
  };

  /**
   * Wrapper for site-aware DAO.save.  Saves object to database
   *
   * @param dbObj
   * @param options
   * @param callback
   */
  SiteQueryService.prototype.save = function (dbObj, options, callback) {
    dbObj = modifySave(this.siteUId, dbObj);
    DAO.prototype.save.call(this, dbObj, options, callback);
  };

  /**
   * Function for getting all collections with site specific content
   */
  /**
   * Funtion for deleting all site specific content by searching all collections for
   * a field named 'site' and adding that collection to an array to be passed in to
   * deleteSiteSpecificContent defined below
   * @param array of collection names
   * @param siteid
   * @param callback
   */
  SiteQueryService.prototype.getCollections = function (cb) {
    var dao = new pb.DAO();
    dao.getAllCollections(function(err, items) {
      if(pb.util.isError(err)) {
        pb.log.error(err);
      }
      cb(err, items);
    })
  };

  /**
   * Funtion for deleting all site specific content
   * @param array of collection names
   * @param siteid
   * @param callback
   */
  SiteQueryService.prototype.deleteSiteSpecificContent = function (collections, siteid, callback) {
    var dao = new pb.DAO();
    var tasks = util.getTasks(collections, function(collections, i) {
      return function(taskCallback) {
        dao.delete({site: siteid}, collections[i].s.name, function(err, numberOfDeletedRecords) {
          if(util.isError(err) || !numberOfDeletedRecords) {
            taskCallback(null, " ");
          } else {
            pb.log.silly(numberOfDeletedRecords + " site specific records associated with " + siteid + " were deleted");
            taskCallback(err, numberOfDeletedRecords);
          }
        });
      };
    });
    async.parallel(tasks, function(err, results) {
      if(pb.util.isError(err)) {
        pb.log.error(err);
        callback(err);
      }
      dao.delete({uid: siteid}, 'site', function(err, result) {
        if(util.isError(err)) {
          pb.log.error("SiteQueryService: Failed to delete record: ", err.stack);
          callback(err);
        }
        pb.log.silly("Successfully deleted site from database: " + result);
        callback(result);
      });
    });

  };

  function modifySave(site, objectToSave) {
    if (pb.config.multisite && !(SITE_FIELD in objectToSave)) {
      objectToSave[SITE_FIELD] = site;
    }
    // else do nothing
    return objectToSave;
  }

  return SiteQueryService;
};