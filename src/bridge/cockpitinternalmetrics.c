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

typedef enum {
  MEMORY_SAMPLER = 0x01
} SamplerSet;

typedef struct {
  const gchar *name;
  const gchar *units;
} MetricDefinition;

typedef struct {
  const gchar *name;
  const gchar *derive;
  SamplerSet sampler;
} MetricInfo;

typedef struct {
  CockpitMetrics parent;
  const gchar *name;

  MetricInfo *metrics;
  const gchar **instances;
  const gchar **omit_instances;
  SamplerSet samplers;
} CockpitInternalMetrics;

typedef struct {
  CockpitMetricsClass parent_class;
} CockpitInternalMetricsClass;

G_DEFINE_TYPE_WITH_CODE (CockpitInternalMetrics, cockpit_internal_metrics, COCKPIT_TYPE_METRICS,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_SAMPLES,
                                                cockpit_samples_interface_init))

static void
cockpit_internal_metrics_init (CockpitInternalMetrics *self)
{
}

static void
cockpit_internal_metrics_tick (CockpitMetrics *metrics,
                               gint64 timestamp)
{
  CockpitInternalMetrics *self = (CockpitInternalMetrics *)metrics;
}

static gboolean
convert_metric_description (CockpitInternalMetrics *self,
                            JsonNode *node,
                            MetricInfo *info,
                            int index)
{
  const gchar *units;

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

      if (!cockpit_json_get_string (json_node_get_object (node), "derive", NULL, &info->derive))
        {
          g_warning ("%s: invalid derivation mode for metric %s (not a string)",
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

  int sampler = find_sampler (info->name);
  if (sampler)
    {
      self->samplers |= sampler;
    }
  else
    {
      g_warning ("%s: unknown internal metric %s", self->name, info->name);
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
