/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitmetrics.h"
#include "cockpitinternalmetrics.h"

#include "common/cockpitjson.h"

/**
 * CockpitInternalMetrics:
 *
 * A #CockpitMetrics channel that pulls data from internal sources
 */

#define COCKPIT_INTERNAL_METRICS(o) \
  (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_INTERNAL_METRICS, CockpitInternalMetrics))

#if 0
typedef void (* FetchCallback) (CockpitSamples *);

typedef struct {
  const gchar *metric;
#if 0
  xxx semantics;
#endif
} MetricInfo;

typedef struct {
  gchar *instance;
  gint64 value;
} MetricData;

typedef struct {
  CockpitMetrics parent;
  const gchar *name;

  MetricInfo *metrics;
  const gchar **instances;
  FetchCallback *callbacks;
  GArray **data;
} CockpitInternalMetrics;

typedef struct {
  CockpitMetricsClass parent_class;
} CockpitInternalMetricsClass;

G_DEFINE_TYPE (CockpitInternalMetrics, cockpit_internal_metrics, COCKPIT_TYPE_METRICS);

static MetricInfo *
parse_metric_info (CockpitInternalMetrics *self,
                   Jsonnode *node)
{
  MetricInfo *ret = NULL;
  MetricInfo *info;

  info = g_new0 (MetricInfo, 1);

  if (json_node_get_node_type (node) != JSON_NODE_OBJECT)
    {
      g_warning ("%s: invalid \"metrics\" option", self->name);
      goto out;
    }

  object = json_node_get_object (node);

  if (!cockpit_json_get_string (object, "name", NULL, &info->name))
    {
      g_warning ("%s: invalid \"name\" option was specified", self->name);
      goto out;
    }
  else if (!name)
    {
      g_warning ("%s: missing \"name\" option was specified", self->name);
      goto out;
    }

  if (!cockpit_json_get_string (object, "type", NULL, &type))
    {
      g_warning ("%s: invalid \"type\" for metric %s", self->name, info->name);
      goto out;
    }
  else if (type && !g_str_equal (type, "number"))
    {
      g_warning ("%s: the \"type\" for metric %s should be \"number\"", self->name, info->name);
      goto out;
    }

  if (!cockpit_json_get_string (object, "semantics", NULL, &semantics))
    {
      g_warning ("%s: invalid \"semantics\" for metric %s", self->name, info->name);
      return FALSE;
    }

  if (!cockpit_json_get_string (object, "units", NULL, &units))
    {
      g_warning ("%s: invalid \"units\" for metric %s", self->name, info->name);
      return FALSE;
        }

  
}

static void
cockpit_internal_metrics_init (CockpitInternalMetrics *self)
{
#if 0
  self->context = -1;
#endif
}

#if 0
static JsonObject *
build_meta (CockpitInternalMetrics *self,
            pmResult *result)
{
  JsonArray *metrics;
  JsonObject *metric;
  JsonArray *instances;
  JsonObject *root;
  pmValueSet *vs;
  gint64 timestamp;
  char *instance;
  int i, j;
  int rc;

  timestamp = (result->timestamp.tv_sec * 1000) +
              (result->timestamp.tv_usec / 1000);

  root = json_object_new ();
  json_object_set_int_member (root, "timestamp", timestamp);
  json_object_set_int_member (root, "interval", self->interval);

  metrics = json_array_new ();
  for (i = 0; i < result->numpmid; i++)
    {
      metric = json_object_new ();

      /* Name
       */
      json_object_set_string_member (metric, "name", self->metrics[i].name);

      /* Instances
       */
      vs = result->vset[i];
      if (vs->numval < 0 || (vs->numval == 1 && vs->vlist[0].inst == PM_IN_NULL))
        {
          /* When negative numval is an error code ... we don't care */
        }
      else
        {
          instances = json_array_new ();

          for (j = 0; j < vs->numval; j++)
            {
              /* PCP guarantees that the result is in the same order as requested */
              rc = pmNameInDom (self->metrics[i].desc.indom, vs->vlist[j].inst, &instance);
              if (rc != 0)
                {
                  g_warning ("%s: instance name lookup failed: %s", self->name, pmErrStr (rc));
                  instance = NULL;
                }

              /* HACK: We can't use json_builder_add_string_value here since
                 it turns empty strings into 'null' values inside arrays.

                 https://bugzilla.gnome.org/show_bug.cgi?id=730803
              */
              {
                JsonNode *string_element = json_node_alloc ();
                json_node_init_string (string_element, instance);
                json_array_add_element (instances, string_element);
              }

              if (instance)
                free (instance);
            }
          json_object_set_array_member (metric, "instances", instances);
        }

      /* Units
       */
      if (self->metrics[i].factor == 1.0)
        {
          json_object_set_string_member (metric, "units", pmUnitsStr(self->metrics[i].units));
        }
      else
        {
          gchar *name = g_strdup_printf ("%s*%g", pmUnitsStr(self->metrics[i].units), 1.0/self->metrics[i].factor);
          json_object_set_string_member (metric, "units", name);
          g_free (name);
        }

      /* Type
       */
      switch (self->metrics[i].desc.type) {
      case PM_TYPE_STRING:
        json_object_set_string_member (metric, "type", "string");
        break;
      case PM_TYPE_32:
      case PM_TYPE_U32:
      case PM_TYPE_64:
      case PM_TYPE_U64:
      case PM_TYPE_FLOAT:
      case PM_TYPE_DOUBLE:
        json_object_set_string_member (metric, "type", "number");
        break;
      default:
        break;
      }

      /* Semantics
       */
      switch (self->metrics[i].desc.sem) {
      case PM_SEM_COUNTER:
        json_object_set_string_member (metric, "semantics", "counter");
        break;
      case PM_SEM_INSTANT:
        json_object_set_string_member (metric, "semantics", "instant");
        break;
      case PM_SEM_DISCRETE:
        json_object_set_string_member (metric, "semantics", "discrete");
        break;
      default:
        break;
      }

      json_array_add_object_element (metrics, metric);
    }

  json_object_set_array_member (root, "metrics", metrics);
  return root;
}

static JsonObject *
build_meta_if_necessary (CockpitInternalMetrics *self)
{
  if (self->last)
    {
      /*
       * If we've already sent the first meta message, then only send
       * another when the set of instances in the results change.
       */

      if (result_meta_equal (self->last, result))
        return NULL;
    }

  return build_meta (self, result);
}

static JsonNode *
build_sample (CockpitInternalMetrics *self,
              pmResult *result,
              int metric,
              int instance)
{
  MetricInfo *info = &self->metrics[metric];
  int valfmt = result->vset[metric]->valfmt;
  pmValue *value = &result->vset[metric]->vlist[instance];
  pmAtomValue sample;

  /* The following mouth full will set sample.d to the appropriate
     value, or return early for special cases and errors.
  */

  if (info->desc.type == PM_TYPE_AGGREGATE || info->desc.type == PM_TYPE_EVENT)
    return NULL;

  if (info->desc.sem == PM_SEM_COUNTER && info->desc.type != PM_TYPE_STRING)
    {
      if (!self->last)
        return NULL;

      pmAtomValue old, new;
      pmValue *last_value = &self->last->vset[metric]->vlist[instance];

      if (info->desc.type == PM_TYPE_64)
        {
          if (pmExtractValue (valfmt, value, PM_TYPE_64, &new, PM_TYPE_64) < 0
              || pmExtractValue (valfmt, last_value, PM_TYPE_64, &old, PM_TYPE_64) < 0)
            return json_node_new (JSON_NODE_NULL);

          sample.d = new.ll - old.ll;
        }
      else if (info->desc.type == PM_TYPE_U64)
        {
          if (pmExtractValue (valfmt, value, PM_TYPE_U64, &new, PM_TYPE_U64) < 0
              || pmExtractValue (valfmt, last_value, PM_TYPE_U64, &old, PM_TYPE_U64) < 0)
            return json_node_new (JSON_NODE_NULL);

          sample.d = new.ull - old.ull;
        }
      else
        {
          if (pmExtractValue (valfmt, value, info->desc.type, &new, PM_TYPE_DOUBLE) < 0
              || pmExtractValue (valfmt, last_value, info->desc.type, &old, PM_TYPE_DOUBLE) < 0)
            return json_node_new (JSON_NODE_NULL);

          sample.d = new.d - old.d;
        }
    }
  else
    {
      if (self->last)
        {
          pmValue *last_value = &self->last->vset[metric]->vlist[instance];
          if (result_value_equal (valfmt, value, last_value))
            return NULL;
        }

      if (info->desc.type == PM_TYPE_STRING)
        {
          if (pmExtractValue (valfmt, value, PM_TYPE_STRING, &sample, PM_TYPE_STRING) < 0)
            return json_node_new (JSON_NODE_NULL);

          JsonNode *node = json_node_new (JSON_NODE_VALUE);
          json_node_set_string (node, sample.cp);
          free (sample.cp);
          return node;
        }
      else
        {
          if (pmExtractValue (valfmt, value, info->desc.type, &sample, PM_TYPE_DOUBLE) < 0)
            return json_node_new (JSON_NODE_NULL);
        }
    }

  if (info->units != &info->desc.units)
    {
      if (pmConvScale (PM_TYPE_DOUBLE, &sample, &info->desc.units, &sample, info->units) < 0)
        return json_node_new (JSON_NODE_NULL);
      sample.d *= info->factor;
    }

  JsonNode *node = json_node_new (JSON_NODE_VALUE);
  json_node_set_double (node, sample.d);
  return node;
}

static JsonArray *
build_samples (CockpitInternalMetrics *self,
               pmResult *result)
{
  CockpitCompressedArrayBuilder samples;
  CockpitCompressedArrayBuilder array;
  pmValueSet *vs;
  int i, j;

  cockpit_compressed_array_builder_init (&samples);

  for (i = 0; i < result->numpmid; i++)
    {
      vs = result->vset[i];

      /* When negative numval is an error code ... we don't care */
      if (vs->numval < 0)
        cockpit_compressed_array_builder_add (&samples, NULL);
      else if (vs->numval == 1 && vs->vlist[0].inst == PM_IN_NULL)
        cockpit_compressed_array_builder_add (&samples, build_sample (self, result, i, 0));
      else
        {
          cockpit_compressed_array_builder_init (&array);
          for (j = 0; j < vs->numval; j++)
            cockpit_compressed_array_builder_add (&array, build_sample (self, result, i, j));
          cockpit_compressed_array_builder_take_and_add_array (&samples,
                                                               cockpit_compressed_array_builder_finish (&array));
        }
    }

  return cockpit_compressed_array_builder_finish (&samples);
}
#endif

static void
cockpit_internal_metrics_tick (CockpitMetrics *metrics,
                               gint64 timestamp)
{
#if 0
  CockpitInternalMetrics *self = (CockpitInternalMetrics *)metrics;
  JsonArray *message;
  JsonObject *meta;
  int rc;

  meta = build_meta_if_necessary (self, result);
  if (meta)
    {
      send_object (self, meta);
      json_object_unref (meta);

      /* We can't compress across a meta message.
       */
      if (self->last)
        pmFreeResult (self->last);
      self->last = NULL;
    }

  /* Send one set of samples */
  message = json_array_new ();
  json_array_add_array_element (message, build_samples (self, result));
  send_array (self, message);
  json_array_unref (message);

  if (self->last)
    pmFreeResult (self->last);
  self->last = result;
#endif
}

#if 0
static gboolean
convert_metric_description (CockpitInternalMetrics *self,
                            JsonNode *node,
                            MetricInfo *info,
                            int index)
{
  const gchar *units;
  const gchar *type;
  const gchar *semantics;

  if (json_node_get_node_type (node) == JSON_NODE_OBJECT)
    {
      if (!cockpit_json_get_string (json_node_get_object (node), "name", NULL, &info->name)
          || info->name == NULL)
        {
          g_warning ("%s: invalid \"metrics\" option was specified (no name for metric %d)",
                     self->name, index);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "units", NULL, &units))
        {
          g_warning ("%s: invalid units for metric %s (not a string)",
                     self->name, info->name);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "type", NULL, &type))
        {
          g_warning ("%s: invalid type for metric %s (not a string)",
                     self->name, info->name);
          return FALSE;
        }

      if (!cockpit_json_get_string (json_node_get_object (node), "semantics", NULL, &semantics))
        {
          g_warning ("%s: invalid semantics for metric %s (not a string)",
                     self->name, info->name);
          return FALSE;
        }
    }
  else
    {
      g_warning ("%s: invalid \"metrics\" option was specified (not an object for metric %d)",
                 self->name, index);
      return FALSE;
    }

  if (pmLookupName (1, (char **)&info->name, &info->id) < 0)
    {
      g_warning ("%s: no such metric: %s (%s)", self->name, info->name, pmErrStr (self->context));
      return FALSE;
    }

  if (pmLookupDesc (info->id, &info->desc) < 0)
    {
      g_warning ("%s: no such metric: %s (%s)", self->name, info->name, pmErrStr (self->context));
      return FALSE;
    }

  if (units)
    {
      if (type == NULL)
        type = "number";

      if (my_pmParseUnitsStr (units, &info->units_buf, &info->factor) < 0)
        {
          g_warning ("%s: failed to parse units: %s", self->name, units);
          return FALSE;
        }

      if (!units_convertible (&info->desc.units, &info->units_buf))
        {
          g_warning ("%s: can't convert metric %s to units %s", self->name, info->name, units);
          return FALSE;
        }

      if (info->factor != 1.0 || !units_equal (&info->desc.units, &info->units_buf))
        info->units = &info->units_buf;
    }

  if (!info->units)
    {
      info->units = &info->desc.units;
      info->factor = 1.0;
    }

  if (g_strcmp0 (type, "number") == 0)
    {
      int dt = info->desc.type;
      if (!(dt == PM_TYPE_32 || dt == PM_TYPE_U32 ||
            dt == PM_TYPE_64 || dt == PM_TYPE_U64 ||
            dt == PM_TYPE_FLOAT || dt == PM_TYPE_DOUBLE))
        {
          g_warning ("%s: metric %s is not a number", self->name, info->name);
          return FALSE;
        }
    }
  else if (g_strcmp0 (type, "string") == 0)
    {
      if (info->desc.type != PM_TYPE_STRING)
        {
          g_warning ("%s: metric %s is not a string", self->name, info->name);
          return FALSE;
        }
    }
  else if (type != NULL)
    {
      g_warning ("%s: unsupported type %s", self->name, type);
      return FALSE;
    }

  if (g_strcmp0 (semantics, "counter") == 0)
    {
      if (info->desc.sem != PM_SEM_COUNTER)
        {
          g_warning ("%s: metric %s is not a counter", self->name, info->name);
          return FALSE;
        }
    }
  else if (g_strcmp0 (semantics, "instant") == 0)
    {
      if (info->desc.sem != PM_SEM_INSTANT)
        {
          g_warning ("%s: metric %s is not instantaneous", self->name, info->name);
          return FALSE;
        }
    }
  else if (g_strcmp0 (semantics, "discrete") == 0)
    {
      if (info->desc.sem != PM_SEM_DISCRETE)
        {
          g_warning ("%s: metric %s is not discrete", self->name, info->name);
          return FALSE;
        }
    }
  else if (semantics != NULL)
    {
      g_warning ("%s: unsupported semantics %s", self->name, semantics);
      return FALSE;
    }

  return TRUE;
}
#endif

static void
cockpit_internal_metrics_prepare (CockpitChannel *channel)
{
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (channel);
  const gchar *problem = "protocol-error";
  JsonObject *options;
  const gchar *source;
  gchar **instances = NULL;
  gchar **omit_instances = NULL;
  JsonArray *metrics;
  const char *name;
  int type;
  int i;

  COCKPIT_CHANNEL_CLASS (cockpit_internal_metrics_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);

  /* "source" option */
  if (!cockpit_json_get_string (options, "source", NULL, &source))
    {
      g_warning ("invalid \"source\" option for metrics channel");
      goto out;
    }
  else if (source)
    {
      g_message ("unsupported \"source\" option specified for metrics: %s", source);
      problem = "not-supported";
      goto out;
    }

  /* "instances" option */
  if (!cockpit_json_get_strv (options, "instances", NULL, (gchar ***)&instances))
    {
      g_warning ("%s: invalid \"instances\" option (not an array of strings)", self->name);
      goto out;
    }

  /* "omit-instances" option */
  if (!cockpit_json_get_strv (options, "omit-instances", NULL, (gchar ***)&omit_instances))
    {
      g_warning ("%s: invalid \"omit-instances\" option (not an array of strings)", self->name);
      goto out;
    }

  /* "metrics" option */
  self->numpmid = 0;
  if (!cockpit_json_get_array (options, "metrics", NULL, &metrics))
    {
      g_warning ("%s: invalid \"metrics\" option was specified (not an array)", self->name);
      goto out;
    }
  if (metrics)
    self->numpmid = json_array_get_length (metrics);

  self->pmidlist = g_new0 (pmID, self->numpmid);
  self->metrics = g_new0 (MetricInfo, self->numpmid);
  for (i = 0; i < self->numpmid; i++)
    {
      MetricInfo *info = &self->metrics[i];
      if (!convert_metric_description (self, json_array_get_element (metrics, i), info, i))
        goto out;

      self->pmidlist[i] = info->id;

      if (info->desc.indom != PM_INDOM_NULL)
        {
          if (instances)
            {
              pmDelProfile (info->desc.indom, 0, NULL);
              for (int i = 0; instances[i]; i++)
                {
                  int instid = pmLookupInDom (info->desc.indom, instances[i]);
                  if (instid >= 0)
                    pmAddProfile (info->desc.indom, 1, &instid);
                }
            }
          else if (omit_instances)
            {
              pmAddProfile (info->desc.indom, 0, NULL);
              for (int i = 0; omit_instances[i]; i++)
                {
                  int instid = pmLookupInDom (info->desc.indom, omit_instances[i]);
                  if (instid >= 0)
                    pmDelProfile (info->desc.indom, 1, &instid);
                }
            }
        }
    }

  /* "interval" option */
  if (!cockpit_json_get_int (options, "interval", 1000, &self->interval))
    {
      g_warning ("%s: invalid \"interval\" option", self->name);
      goto out;
    }
  else if (self->interval <= 0 || self->interval > G_MAXINT)
    {
      g_warning ("%s: invalid \"interval\" value: %" G_GINT64_FORMAT, self->name, self->interval);
      goto out;
    }

  problem = NULL;
  cockpit_metrics_metronome (COCKPIT_METRICS (self), self->interval);
  cockpit_channel_ready (channel);

out:
  if (problem)
    cockpit_channel_close (channel, problem);
  g_free (instances);
  g_free (omit_instances);
}

static void
cockpit_internal_metrics_dispose (GObject *object)
{
#if 0
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (object);
#endif
  G_OBJECT_CLASS (cockpit_internal_metrics_parent_class)->dispose (object);
}

static void
cockpit_internal_metrics_finalize (GObject *object)
{
#if 0
  CockpitInternalMetrics *self = COCKPIT_INTERNAL_METRICS (object);
#endif
  G_OBJECT_CLASS (cockpit_internal_metrics_parent_class)->finalize (object);
}

static void
cockpit_internal_metrics_class_init (CockpitInternalMetricsClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitMetricsClass *metrics_class = COCKPIT_METRICS_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_internal_metrics_dispose;
  gobject_class->finalize = cockpit_internal_metrics_finalize;

  channel_class->prepare = cockpit_internal_metrics_prepare;
  metrics_class->tick = cockpit_internal_metrics_tick;
}
#endif
