-- Which drivers were already alerted about each open job, so a job that goes back out (driver
-- taken off it) only alerts drivers who haven't heard about it. Owners are alerted every time.
CREATE TABLE order_driver_alerts (
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, driver_id)
);
